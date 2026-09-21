/* API-Sports.io: the secondary source, twelve sports on one schema.

   100 requests a DAY per sport API. That is tight enough that this is
   never used for anything a primary source can serve. It exists for
   endpoints the primaries do not cover, and every call through it is
   cached hard, at the standings or metadata TTL rather than the live one.

   One key works across every sport host. Without API_SPORTS_KEY set, this
   reports itself unconfigured and callers skip it. */

import { getJson, UpstreamError } from "../http.js";
import { makeFixture, mapStatus, toNumberOrNull, toISO } from "../normalise.js";

const SOURCE = "API-Sports";

export const id = "apisports";

/* Each sport is its own host, sharing one key and one schema. */
export const HOSTS = {
  football: "v3.football.api-sports.io",
  basketball: "v1.basketball.api-sports.io",
  nba: "v2.nba.api-sports.io",
  americanfootball: "v1.american-football.api-sports.io",
  baseball: "v1.baseball.api-sports.io",
  hockey: "v1.hockey.api-sports.io",
  formula1: "v1.formula-1.api-sports.io",
  rugby: "v1.rugby.api-sports.io",
  volleyball: "v1.volleyball.api-sports.io",
  handball: "v1.handball.api-sports.io",
  mma: "v1.mma.api-sports.io",
  afl: "v1.afl.api-sports.io",
};

export function isConfigured() {
  return Boolean(process.env.API_SPORTS_KEY);
}

function headers(host) {
  if (!isConfigured()) {
    throw new UpstreamError(SOURCE, 401, "API_SPORTS_KEY is not set");
  }
  return { "x-rapidapi-key": process.env.API_SPORTS_KEY, "x-rapidapi-host": host };
}

/* The generic games shape, which every non-football host shares. */
function gameToFixture(game, sport) {
  return makeFixture({
    id: `as-${sport}-${game.id}`,
    sport,
    competition: game.league?.name || null,
    homeName: game.teams?.home?.name || null,
    awayName: game.teams?.away?.name || null,
    homeScore: toNumberOrNull(game.scores?.home?.total ?? game.scores?.home),
    awayScore: toNumberOrNull(game.scores?.away?.total ?? game.scores?.away),
    status: mapStatus(game.status?.long || game.status?.short),
    startTime: toISO(game.date),
    venue: game.venue?.name || game.venue || null,
    source: SOURCE,
    sourceTimezone: game.timezone || "UTC",
    delayed: true,
    homeBadge: game.teams?.home?.logo || null,
    awayBadge: game.teams?.away?.logo || null,
  });
}

export async function fetchByDate(sport, date) {
  const host = HOSTS[sport];
  if (!host) throw new UpstreamError(SOURCE, 400, `no API-Sports host for ${sport}`);

  const day = String(date).slice(0, 10);
  const data = await getJson(`https://${host}/games?date=${encodeURIComponent(day)}`, {
    source: SOURCE,
    headers: headers(host),
  });

  return (data?.response || []).map((game) => gameToFixture(game, sport));
}

/* How many of today's 100 are left, as reported by the upstream. Surfaced
   in the health endpoint so the quota is visible before it runs out
   rather than after. */
export async function remainingQuota(sport = "basketball") {
  const host = HOSTS[sport];
  if (!host || !isConfigured()) return null;

  try {
    const response = await fetch(`https://${host}/status`, { headers: headers(host) });
    const data = await response.json();
    const limit = data?.response?.requests?.limit_day;
    const used = data?.response?.requests?.current;
    if (limit === undefined || used === undefined) return null;
    return { used, limit, remaining: limit - used };
  } catch {
    return null;
  }
}
