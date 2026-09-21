/* SportsAPI Pro: the badminton section.

   This closes one of uwuSports' two coverage gaps. Badminton previously
   shipped as a coming-soon state saying no free source existed, which was
   true when this app was built and is no longer.

   Free plan is $0 and 100 requests a day, resetting at midnight UTC.
   Coverage is identical on free and paid; the paid plans only raise the
   quota, so nothing here is degraded relative to a paying integration.

   Two things make that 100 tighter than it looks:

     1. The quota is shared across all 25 of this provider's sports, not
        per sport. Adding a second sport from here spends the same budget.
     2. A day's schedule is one request, so a reader refreshing during a
        BWF final could exhaust it alone.

   So every call goes through the schedule TTL, never the live one, and
   the section is honest about being delayed. */

import { getJson, UpstreamError } from "../http.js";
import { makeFixture, mapStatus, toNumberOrNull, toISO } from "../normalise.js";

const BASE = "https://api.sportsapipro.com/v2/badminton";
const SOURCE = "SportsAPI Pro";

export const id = "sportsapipro";
export const sport = "badminton";

export function isConfigured() {
  return Boolean(process.env.SPORTSAPIPRO_API_KEY);
}

function headers() {
  if (!isConfigured()) {
    throw new UpstreamError(SOURCE, 401, "SPORTSAPIPRO_API_KEY is not set");
  }
  return { "x-api-key": process.env.SPORTSAPIPRO_API_KEY };
}

/* status.type is the reliable field: "inprogress", "finished", "notstarted".
   status.description is prose like "3rd Game" and is shown, not parsed. */
function statusFor(status) {
  const type = String(status?.type || "").toLowerCase();

  if (type === "inprogress") return "live";
  if (type === "finished") return "finished";
  if (type === "notstarted") return "scheduled";
  if (type === "canceled" || type === "cancelled") return "cancelled";
  if (type === "postponed") return "postponed";

  // Fall back to the shared vocabulary mapper on the prose description.
  return mapStatus(status?.description);
}

/* A badminton match is games, not one aggregate score. homeScore carries
   games won, which is what "current" holds and what belongs on a card.
   The per-game breakdown goes in extra, for the detail view. */
function games(score) {
  return [score?.period1, score?.period2, score?.period3]
    .map(toNumberOrNull)
    .filter((n) => n !== null && n > 0);
}

function eventToFixture(event) {
  const homeGames = games(event.homeScore);
  const awayGames = games(event.awayScore);

  return makeFixture({
    id: `bwf-${event.id}`,
    sport: "badminton",
    competition: event.tournament?.name || null,
    /* Singles players or doubles pairs, both of which the upstream models
       as teams, so the shared shape needs no special case here. */
    homeName: event.homeTeam?.name || null,
    awayName: event.awayTeam?.name || null,
    homeScore: toNumberOrNull(event.homeScore?.current),
    awayScore: toNumberOrNull(event.awayScore?.current),
    status: statusFor(event.status),
    /* startTimestamp is unix seconds, so it needs converting before toISO
       reads it as milliseconds and lands in 1970. */
    startTime: event.startTimestamp ? toISO(new Date(event.startTimestamp * 1000)) : null,
    venue: event.venue?.name || null,
    source: SOURCE,
    sourceTimezone: "UTC",
    /* Cached at the schedule TTL to protect a 100 a day quota, so what a
       reader sees is minutes old even when the upstream is live. */
    delayed: true,
    extra: homeGames.length || awayGames.length
      ? {
          games: homeGames.map((h, i) => ({ home: h, away: awayGames[i] ?? null })),
          currentPoints: {
            home: event.homeScore?.point ?? null,
            away: event.awayScore?.point ?? null,
          },
        }
      : null,
  });
}

function eventsFrom(data) {
  if (Array.isArray(data)) return data;
  return data?.events || [];
}

export async function fetchByDate(date) {
  const day = String(date).slice(0, 10);

  /* /api/today and /api/schedule/:date return the same shape. The schedule
     endpoint populates close to match day, which is fine here: this app
     asks for today and the days immediately around it. */
  const url = `${BASE}/api/schedule/${encodeURIComponent(day)}`;

  const data = await getJson(url, { source: SOURCE, headers: headers() });
  return eventsFrom(data).map(eventToFixture);
}

export async function fetchLive() {
  const data = await getJson(`${BASE}/api/live`, { source: SOURCE, headers: headers() });
  return eventsFrom(data).map(eventToFixture);
}

export async function searchPlayers(query) {
  try {
    const data = await getJson(`${BASE}/api/search?q=${encodeURIComponent(query)}`, {
      source: SOURCE,
      headers: headers(),
    });

    const results = Array.isArray(data) ? data : data?.results || data?.teams || [];

    return results.slice(0, 20).map((item) => ({
      kind: "team",
      sport: "badminton",
      id: String(item.id),
      name: item.name || item.shortName || String(item.id),
      subtitle: "Badminton",
      badge: null,
    }));
  } catch (cause) {
    /* Search spends a request from a shared 100 a day budget, so a failure
       here degrades to no badminton results and never fails the search. */
    console.warn("[sportsapipro] search unavailable:", cause?.message);
    return [];
  }
}
