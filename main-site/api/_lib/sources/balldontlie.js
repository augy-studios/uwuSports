/* balldontlie: the NBA section.

   The free tier now requires a free API key from app.balldontlie.io, no
   card. Roughly 60 requests a minute. Without BALLDONTLIE_API_KEY set,
   every function here throws a configuration error instead of returning
   invented games; the endpoint turns that into an honest "not configured"
   state in the UI.

   Live game data refreshes upstream about every 10 minutes, so every
   fixture from this source carries delayed: true and the UI labels it as
   delayed and not live. */

import { getJson, UpstreamError } from "../http.js";
import { makeFixture, mapStatus, toNumberOrNull, toISO } from "../normalise.js";

const BASE = "https://api.balldontlie.io/v1";
const SOURCE = "balldontlie";

export const id = "balldontlie";
export const sport = "basketball";

export function isConfigured() {
  return Boolean(process.env.BALLDONTLIE_API_KEY);
}

function headers() {
  if (!isConfigured()) {
    throw new UpstreamError(SOURCE, 401, "BALLDONTLIE_API_KEY is not set");
  }
  return { Authorization: process.env.BALLDONTLIE_API_KEY };
}

function gameToFixture(game) {
  /* The upstream status field is either a clock like "Q3 4:21", a date
     string for an unplayed game, or "Final". mapStatus handles the first
     and last; a bare date means not started. */
  const raw = game.status || "";
  const looksLikeDate = /^\d{4}-\d{2}-\d{2}/.test(raw);
  const status = looksLikeDate ? "scheduled" : mapStatus(raw, { liveWords: ["q1", "q2", "q3", "q4", "ot"] });

  return makeFixture({
    id: `nba-${game.id}`,
    sport: "basketball",
    competition: "NBA",
    homeName: game.home_team?.full_name || null,
    awayName: game.visitor_team?.full_name || null,
    homeScore: toNumberOrNull(game.home_team_score),
    awayScore: toNumberOrNull(game.visitor_team_score),
    status,
    startTime: toISO(game.datetime || game.date),
    venue: null,
    source: SOURCE,
    sourceTimezone: "US/Eastern",
    /* Not live, whatever the clock says. The upstream is on a 10 minute
       refresh and pretending otherwise would be the one dishonest thing
       in the app. */
    delayed: true,
  });
}

export async function fetchByDate(date) {
  const url = `${BASE}/games?dates[]=${encodeURIComponent(String(date).slice(0, 10))}&per_page=100`;
  const data = await getJson(url, { source: SOURCE, headers: headers() });
  return (data?.data || []).map(gameToFixture);
}

export async function fetchGame(gameId) {
  const numeric = String(gameId).replace(/^nba-/, "");
  const data = await getJson(`${BASE}/games/${encodeURIComponent(numeric)}`, {
    source: SOURCE,
    headers: headers(),
  });

  if (!data?.data) return null;

  const fixture = gameToFixture(data.data);

  /* The box score endpoint is a separate call and a separate rate limit
     hit, so it is only made on the detail view, never on a list. */
  try {
    const box = await getJson(`${BASE}/box_scores?game_ids[]=${encodeURIComponent(numeric)}`, {
      source: SOURCE,
      headers: headers(),
    });

    const game = box?.data?.[0];
    if (game) {
      fixture.extra = {
        boxScore: [
          {
            team: game.home_team?.full_name || fixture.homeName,
            periods: (game.home_team?.periods || []).map((p) => String(p)),
            total: String(game.home_team_score ?? fixture.homeScore ?? ""),
          },
          {
            team: game.visitor_team?.full_name || fixture.awayName,
            periods: (game.visitor_team?.periods || []).map((p) => String(p)),
            total: String(game.visitor_team_score ?? fixture.awayScore ?? ""),
          },
        ],
      };
    }
  } catch (cause) {
    /* No box score is not a broken detail view. */
    console.warn("[balldontlie] box score unavailable:", cause?.message);
  }

  return fixture;
}

export async function fetchStandings() {
  const season = new Date().getUTCFullYear() - (new Date().getUTCMonth() < 8 ? 1 : 0);
  const data = await getJson(`${BASE}/standings?season=${season}`, {
    source: SOURCE,
    headers: headers(),
  });

  const rows = (data?.data || [])
    .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0))
    .map((row, i) => [
      String(i + 1),
      row.team?.full_name || "",
      String(row.wins ?? ""),
      String(row.losses ?? ""),
      row.conference_record || "",
    ]);

  return { title: `NBA, ${season} to ${season + 1}`, columns: ["Pos", "Team", "W", "L", "Conf"], rows };
}

export async function searchTeams(query) {
  const data = await getJson(`${BASE}/teams?per_page=100`, { source: SOURCE, headers: headers() });
  const needle = query.toLowerCase();

  return (data?.data || [])
    .filter((t) => `${t.full_name} ${t.abbreviation}`.toLowerCase().includes(needle))
    .map((t) => ({
      kind: "team",
      sport: "basketball",
      id: String(t.id),
      name: t.full_name,
      subtitle: `NBA, ${t.conference || ""}`.trim(),
      badge: null,
    }));
}
