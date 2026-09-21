/* Highlightly: the secondary source, replacing API-Sports.

   Free forever, 100 requests a day, no card. Covers the sports the primary
   sources do not: hockey, rugby, handball, volleyball, cricket, baseball
   and American football, plus football and basketball it does not need to
   serve here.

   The 100 a day limit is why this is a gap filler and not a section owner.
   It is the same shape of budget API-Sports had, so the same rule applies:
   never use it for anything a primary source can serve, and cache
   everything through it at the schedule or metadata TTL, never the live
   one.

   Why this and not API-Sports: the API-Sports signup dashboard stopped
   resolving, so a key cannot be obtained. Highlightly is a like for like
   swap on tier, price and coverage, and both of its hosts respond.

   Each sport is its own subdomain sharing one key and one schema, which is
   what keeps this a single adapter rather than one per sport. */

import { getJson, UpstreamError } from "../http.js";
import { makeFixture, mapStatus, toNumberOrNull, toISO } from "../normalise.js";

const SOURCE = "Highlightly";

export const id = "highlightly";

/* Direct hosts. The RapidAPI distribution of the same service uses
   sport-highlights-api.p.rapidapi.com with the same key header, so
   HIGHLIGHTLY_USE_RAPIDAPI switches hosts without touching anything else. */
export const HOSTS = {
  football: "soccer.highlightly.net",
  basketball: "basketball.highlightly.net",
  hockey: "hockey.highlightly.net",
  rugby: "rugby.highlightly.net",
  handball: "handball.highlightly.net",
  volleyball: "volleyball.highlightly.net",
  cricket: "cricket.highlightly.net",
  baseball: "baseball.highlightly.net",
  americanfootball: "american-football.highlightly.net",
};

const RAPIDAPI_HOST = "sport-highlights-api.p.rapidapi.com";

/* The sports uwuSports actually surfaces through this source. Football and
   basketball are deliberately absent: football-data and balldontlie own
   those, and spending a 100 a day budget duplicating them would be the
   mistake this file exists to avoid. */
export const GAP_SPORTS = ["hockey", "rugby", "handball", "volleyball", "cricket"];

export function isConfigured() {
  return Boolean(process.env.HIGHLIGHTLY_API_KEY);
}

function useRapidApi() {
  return process.env.HIGHLIGHTLY_USE_RAPIDAPI === "1";
}

function baseFor(sport) {
  if (useRapidApi()) return `https://${RAPIDAPI_HOST}/${sport}`;

  const host = HOSTS[sport];
  if (!host) throw new UpstreamError(SOURCE, 400, `no Highlightly host for ${sport}`);
  return `https://${host}`;
}

function headers(sport) {
  if (!isConfigured()) {
    throw new UpstreamError(SOURCE, 401, "HIGHLIGHTLY_API_KEY is not set");
  }

  /* The direct hosts and the RapidAPI distribution both read the key from
     x-rapidapi-key. Only RapidAPI additionally wants the host header. */
  const value = { "x-rapidapi-key": process.env.HIGHLIGHTLY_API_KEY };
  if (useRapidApi()) value["x-rapidapi-host"] = RAPIDAPI_HOST;
  return value;
}

/* state.score.current is a display string, "2 - 1", rather than a pair of
   numbers. Anything unparseable stays null rather than becoming a zero:
   a nil-nil draw and a match with no score published are different facts. */
function splitScore(state) {
  const raw = state?.score?.current;
  if (typeof raw !== "string") return [null, null];

  const parts = raw.split(/\s*-\s*/);
  if (parts.length !== 2) return [null, null];

  return [toNumberOrNull(parts[0]), toNumberOrNull(parts[1])];
}

function matchToFixture(match, sport) {
  const [homeScore, awayScore] = splitScore(match.state);

  return makeFixture({
    id: `hl-${sport}-${match.id}`,
    sport,
    competition: match.league?.name || null,
    homeName: match.homeTeam?.name || null,
    awayName: match.awayTeam?.name || null,
    homeScore,
    awayScore,
    status: mapStatus(match.state?.description, {
      liveWords: ["first half", "second half", "period", "set"],
    }),
    startTime: toISO(match.date),
    venue: match.venue?.name || null,
    source: SOURCE,
    sourceTimezone: "UTC",
    /* Highlightly publishes a live clock, but on a 100 a day budget this
       is polled at the schedule TTL, so what a reader sees is minutes old
       by design. Labelled delayed rather than pretending otherwise. */
    delayed: true,
    homeBadge: match.homeTeam?.logo || null,
    awayBadge: match.awayTeam?.logo || null,
  });
}

export async function fetchByDate(sport, date) {
  const day = String(date).slice(0, 10);
  const url = `${baseFor(sport)}/matches?date=${encodeURIComponent(day)}&limit=100`;

  const data = await getJson(url, { source: SOURCE, headers: headers(sport) });

  /* The payload is { data: [...] } on the direct hosts and a bare array on
     some endpoints, so both are accepted rather than assuming one. */
  const matches = Array.isArray(data) ? data : data?.data || [];

  return matches.map((match) => matchToFixture(match, sport));
}

/* Every gap sport for one day, settled independently so one sport being
   down does not empty the others. Five requests, which is why the caller
   caches this at the schedule TTL and never the live one. */
export async function fetchGapSports(date, { sports = GAP_SPORTS } = {}) {
  if (!isConfigured()) return [];

  const settled = await Promise.allSettled(sports.map((sport) => fetchByDate(sport, date)));

  const fixtures = [];

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") fixtures.push(...outcome.value);
  }

  return fixtures;
}

export async function fetchStandings(sport, leagueId) {
  const url = `${baseFor(sport)}/standings?leagueId=${encodeURIComponent(leagueId)}`;
  const data = await getJson(url, { source: SOURCE, headers: headers(sport) });

  const groups = Array.isArray(data) ? data : data?.data || [];
  const rows = [];

  for (const group of groups) {
    for (const row of group?.standings || []) {
      rows.push([
        String(row.position ?? ""),
        row.team?.name || "",
        String(row.played ?? ""),
        String(row.won ?? ""),
        String(row.lost ?? ""),
        String(row.points ?? ""),
      ]);
    }
  }

  return { title: groups[0]?.league?.name || "Standings", columns: ["Pos", "Team", "P", "W", "L", "Pts"], rows };
}
