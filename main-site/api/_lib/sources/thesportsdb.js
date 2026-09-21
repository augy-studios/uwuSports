/* TheSportsDB: badges and artwork across the whole app, plus the general
   multi-sport browse section.

   The free public test key is "3" and needs no signup. 30 requests a
   minute.

   Two free tier caveats shape how this is used. Many search queries are
   restricted, and livescores are premium only. So this is a schedules,
   metadata and artwork source, and never a live scores source: anything
   it returns as in progress is not trusted for a score. */

import { getJson } from "../http.js";
import { makeFixture, mapStatus, toNumberOrNull, combineDateTime } from "../normalise.js";

const KEY = process.env.THESPORTSDB_API_KEY || "3";
const BASE = `https://www.thesportsdb.com/api/v1/json/${KEY}`;
const SOURCE = "TheSportsDB";

export const id = "thesportsdb";

/* Badge lookups are the hot path: every fixture card wants one and they
   never change. Cached for 24 hours by the caller, and memoised here so a
   list of 40 fixtures does not make 40 identical calls in one invocation. */
const badgeMemo = new Map();

/* TheSportsDB spells sports its own way, and the eventsday endpoint wants
   the underscored form. This maps both directions onto the internal ids
   the rest of the app uses, so a browse fixture carries the sport it
   actually is and not a flat "multi". */
const SPORT_IDS = {
  Ice_Hockey: "hockey",
  "Ice Hockey": "hockey",
  Rugby: "rugby",
  "Rugby Union": "rugby",
  "Rugby League": "rugby",
  Cricket: "cricket",
  Baseball: "baseball",
  American_Football: "americanfootball",
  "American Football": "americanfootball",
  Handball: "handball",
  Volleyball: "volleyball",
};

function sportIdFor(raw) {
  if (!raw) return "multi";
  return SPORT_IDS[raw] || SPORT_IDS[String(raw).replace(/_/g, " ")] || "multi";
}

function eventToFixture(event, requestedSport) {
  const scoreHome = toNumberOrNull(event.intHomeScore);
  const scoreAway = toNumberOrNull(event.intAwayScore);
  const hasScore = scoreHome !== null && scoreAway !== null;

  /* No livescore on the free tier, so an event with a score is finished
     and one without has not started. Anything else is unknown and not
     guessed at. */
  let status = mapStatus(event.strStatus);
  if (status === "unknown" || status === "live") status = hasScore ? "finished" : "scheduled";

  return makeFixture({
    id: `tsdb-${event.idEvent}`,
    /* The event's own strSport is the truth; the sport we asked for is the
       fallback when a free tier response omits it. */
    sport: sportIdFor(event.strSport || requestedSport),
    competition: event.strLeague || null,
    homeName: event.strHomeTeam || null,
    awayName: event.strAwayTeam || null,
    homeScore: scoreHome,
    awayScore: scoreAway,
    status,
    startTime: combineDateTime(event.dateEvent, event.strTime),
    venue: event.strVenue || null,
    source: SOURCE,
    sourceTimezone: "UTC",
    homeBadge: event.strHomeTeamBadge || null,
    awayBadge: event.strAwayTeamBadge || null,
  });
}

/* Events on a day, across the sports worth surfacing in browse. The free
   tier's eventsday endpoint takes one sport at a time. */
const BROWSE_SPORTS = ["Ice_Hockey", "Rugby", "Cricket", "Baseball", "American_Football"];

export async function fetchByDate(date, { sports = BROWSE_SPORTS } = {}) {
  const day = String(date).slice(0, 10);

  const batches = await Promise.allSettled(
    sports.map((sport) =>
      getJson(`${BASE}/eventsday.php?d=${encodeURIComponent(day)}&s=${encodeURIComponent(sport)}`, {
        source: SOURCE,
      })
    )
  );

  const fixtures = [];

  /* Indexed, so each batch keeps the sport it was requested for. Without
     that the fallback in eventToFixture has nothing to fall back to. */
  batches.forEach((batch, i) => {
    if (batch.status !== "fulfilled") return;
    const events = batch.value?.events;
    if (!Array.isArray(events)) return;
    for (const event of events) fixtures.push(eventToFixture(event, sports[i]));
  });

  return fixtures;
}

export async function fetchLeagueSeason(leagueId, season) {
  const data = await getJson(
    `${BASE}/eventsseason.php?id=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`,
    { source: SOURCE }
  );
  return (data?.events || []).map(eventToFixture);
}

/* Badge for a team name. Returns null instead of throwing: a missing
   badge is a cosmetic gap, and the card falls back to an initial. */
export async function badgeFor(teamName) {
  if (!teamName) return null;

  const key = teamName.toLowerCase();
  if (badgeMemo.has(key)) return badgeMemo.get(key);

  try {
    const data = await getJson(`${BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`, {
      source: SOURCE,
    });

    const badge = data?.teams?.[0]?.strTeamBadge || data?.teams?.[0]?.strBadge || null;
    badgeMemo.set(key, badge);
    return badge;
  } catch {
    badgeMemo.set(key, null);
    return null;
  }
}

/* Decorate a list of fixtures with badges, in one pass, without letting a
   slow artwork lookup hold up the fixtures themselves. Bounded so a busy
   Saturday does not fire 80 requests against a 30 per minute limit. */
export async function decorateBadges(fixtures, { limit = 12 } = {}) {
  const names = new Set();

  for (const fixture of fixtures) {
    if (fixture.homeBadge && fixture.awayBadge) continue;
    if (fixture.homeName) names.add(fixture.homeName);
    if (fixture.awayName) names.add(fixture.awayName);
    if (names.size >= limit) break;
  }

  const lookups = await Promise.allSettled([...names].map(async (name) => [name, await badgeFor(name)]));

  const found = new Map();
  for (const result of lookups) {
    if (result.status === "fulfilled" && result.value[1]) found.set(result.value[0], result.value[1]);
  }

  for (const fixture of fixtures) {
    if (!fixture.homeBadge && found.has(fixture.homeName)) fixture.homeBadge = found.get(fixture.homeName);
    if (!fixture.awayBadge && found.has(fixture.awayName)) fixture.awayBadge = found.get(fixture.awayName);
  }

  return fixtures;
}

export async function searchTeams(query) {
  try {
    const data = await getJson(`${BASE}/searchteams.php?t=${encodeURIComponent(query)}`, {
      source: SOURCE,
    });

    return (data?.teams || []).slice(0, 20).map((team) => ({
      kind: "team",
      sport: sportIdFor(team.strSport),
      id: team.idTeam,
      name: team.strTeam,
      subtitle: [team.strSport, team.strLeague].filter(Boolean).join(", "),
      badge: team.strTeamBadge || team.strBadge || null,
    }));
  } catch {
    /* Search is restricted on the free tier often enough that a failure
       here is expected as opposed to exceptional. */
    return [];
  }
}
