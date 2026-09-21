/* football-data.org: the football section.

   Free key, no card, 10 requests a minute across twelve major
   competitions. That limit is the tightest of the primary sources, so the
   schedule TTL matters more here than anywhere else.

   Scores are delayed on the free tier, so every fixture carries
   delayed: true and the UI says so. */

import { getJson, UpstreamError } from "../http.js";
import { makeFixture, mapStatus, toNumberOrNull, toISO } from "../normalise.js";

const BASE = "https://api.football-data.org/v4";
const SOURCE = "football-data.org";

export const id = "footballdata";
export const sport = "football";

/* The twelve on the free tier. Named here so the UI can offer a filter
   without discovering them at runtime and spending a request on it. */
export const COMPETITIONS = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "BL1", name: "Bundesliga" },
  { code: "SA", name: "Serie A" },
  { code: "FL1", name: "Ligue 1" },
  { code: "CL", name: "Champions League" },
  { code: "DED", name: "Eredivisie" },
  { code: "PPL", name: "Primeira Liga" },
  { code: "ELC", name: "Championship" },
  { code: "BSA", name: "Brasileirao" },
  { code: "CLI", name: "Copa Libertadores" },
  { code: "EC", name: "European Championship" },
];

export function isConfigured() {
  return Boolean(process.env.FOOTBALL_DATA_API_KEY);
}

function headers() {
  if (!isConfigured()) {
    throw new UpstreamError(SOURCE, 401, "FOOTBALL_DATA_API_KEY is not set");
  }
  return { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY };
}

function matchToFixture(match) {
  return makeFixture({
    id: `fd-${match.id}`,
    sport: "football",
    competition: match.competition?.name || null,
    homeName: match.homeTeam?.name || match.homeTeam?.shortName || null,
    awayName: match.awayTeam?.name || match.awayTeam?.shortName || null,
    homeScore: toNumberOrNull(match.score?.fullTime?.home),
    awayScore: toNumberOrNull(match.score?.fullTime?.away),
    status: mapStatus(match.status, {
      finishedWords: ["finished"],
      liveWords: ["in_play", "paused"],
    }),
    startTime: toISO(match.utcDate),
    venue: match.venue || null,
    source: SOURCE,
    sourceTimezone: "UTC",
    delayed: true,
    homeBadge: match.homeTeam?.crest || null,
    awayBadge: match.awayTeam?.crest || null,
  });
}

/* One call covers every competition on the free tier for a given day,
   which matters at 10 requests a minute. */
export async function fetchByDate(date) {
  const day = String(date).slice(0, 10);
  const url = `${BASE}/matches?dateFrom=${day}&dateTo=${day}`;

  const data = await getJson(url, { source: SOURCE, headers: headers() });
  return (data?.matches || []).map(matchToFixture);
}

export async function fetchMatch(matchId) {
  const numeric = String(matchId).replace(/^fd-/, "");
  const data = await getJson(`${BASE}/matches/${encodeURIComponent(numeric)}`, {
    source: SOURCE,
    headers: headers(),
  });

  if (!data) return null;

  const fixture = matchToFixture(data);

  fixture.extra = {
    halfTime: {
      home: toNumberOrNull(data.score?.halfTime?.home),
      away: toNumberOrNull(data.score?.halfTime?.away),
    },
    referees: (data.referees || []).map((r) => r.name).filter(Boolean),
  };

  return fixture;
}

export async function fetchStandings(code = "PL") {
  const data = await getJson(`${BASE}/competitions/${encodeURIComponent(code)}/standings`, {
    source: SOURCE,
    headers: headers(),
  });

  const table = data?.standings?.find((s) => s.type === "TOTAL")?.table || [];

  return {
    title: data?.competition?.name || code,
    columns: ["Pos", "Team", "P", "W", "D", "L", "GD", "Pts"],
    rows: table.map((row) => [
      String(row.position),
      row.team?.shortName || row.team?.name || "",
      String(row.playedGames ?? ""),
      String(row.won ?? ""),
      String(row.draw ?? ""),
      String(row.lost ?? ""),
      String(row.goalDifference ?? ""),
      String(row.points ?? ""),
    ]),
  };
}

export async function searchTeams(query) {
  /* No team search endpoint on the free tier, so this walks the cached
     competition tables instead of spending requests on a lookup that does
     not exist. Called only from the search endpoint, which caches hard. */
  const needle = query.toLowerCase();
  const results = [];

  for (const comp of COMPETITIONS.slice(0, 5)) {
    try {
      const standings = await fetchStandings(comp.code);
      for (const row of standings.rows) {
        if (row[1].toLowerCase().includes(needle)) {
          results.push({
            kind: "team",
            sport: "football",
            id: `${comp.code}-${row[1]}`,
            name: row[1],
            subtitle: comp.name,
            badge: null,
          });
        }
      }
    } catch {
      /* One competition failing does not fail the search. */
    }

    if (results.length >= 10) break;
  }

  return results;
}
