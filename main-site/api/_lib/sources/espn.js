/* ESPN's public endpoints: an enhancement layer, never a section's only
   source.

   These are undocumented, unofficial and unsupported. They are also the
   fastest live-ish free scores available, which is exactly the tension.
   The rule from the spec: use as an enhancement only, and fail gracefully
   to the primary source.

   So nothing here ever produces a fixture list of its own. It only
   enriches fixtures that a primary source already returned, by matching on
   team names, and any failure leaves those fixtures exactly as they were.

   Set ESPN_ENABLED=0 to switch the layer off if the endpoints start
   returning nonsense. */

import { getJson } from "../http.js";
import { mapStatus, toNumberOrNull } from "../normalise.js";

const SOURCE = "ESPN";

export const id = "espn";

const SCOREBOARDS = {
  basketball: "basketball/nba",
  football: "soccer/eng.1",
};

export function isEnabled() {
  return process.env.ESPN_ENABLED !== "0";
}

function normaliseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|club|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

async function fetchScoreboard(league) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`;
  const data = await getJson(url, { source: SOURCE, timeout: 5000 });

  const events = data?.events || [];
  const rows = [];

  for (const event of events) {
    const competition = event.competitions?.[0];
    const competitors = competition?.competitors || [];

    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) continue;

    rows.push({
      homeKey: normaliseName(home.team?.displayName),
      awayKey: normaliseName(away.team?.displayName),
      homeScore: toNumberOrNull(home.score),
      awayScore: toNumberOrNull(away.score),
      status: mapStatus(competition?.status?.type?.name || competition?.status?.type?.state, {
        liveWords: ["in", "status_in_progress"],
        finishedWords: ["status_final"],
      }),
      detail: competition?.status?.type?.shortDetail || null,
    });
  }

  return rows;
}

/* Enrich in place. Only in-progress fixtures are touched: a finished game
   already has its final score from the primary source, and overwriting a
   scheduled one with ESPN's idea of the fixture list is how an unofficial
   endpoint would quietly become the source of truth. */
export async function enhance(fixtures, sport) {
  if (!isEnabled()) return fixtures;

  const league = SCOREBOARDS[sport];
  if (!league) return fixtures;

  const candidates = fixtures.filter((f) => f.status === "live" || f.status === "scheduled");
  if (!candidates.length) return fixtures;

  let rows;
  try {
    rows = await fetchScoreboard(league);
  } catch (cause) {
    /* Silent by design. The primary source's data is already on screen and
       is correct, just slower. */
    console.warn("[espn] enhancement unavailable:", cause?.message);
    return fixtures;
  }

  for (const fixture of candidates) {
    const homeKey = normaliseName(fixture.homeName);
    const awayKey = normaliseName(fixture.awayName);

    const match = rows.find(
      (r) =>
        (r.homeKey.includes(homeKey) || homeKey.includes(r.homeKey)) &&
        (r.awayKey.includes(awayKey) || awayKey.includes(r.awayKey))
    );

    if (!match) continue;
    if (match.status !== "live" && match.status !== "finished") continue;

    if (match.homeScore !== null && match.awayScore !== null) {
      fixture.homeScore = match.homeScore;
      fixture.awayScore = match.awayScore;
      fixture.status = match.status;
      /* An ESPN-sourced score is close to real time, so the delayed label
         that the primary source set no longer applies to this fixture. */
      fixture.delayed = false;
      fixture.source = `${fixture.source}, live score via ${SOURCE}`;
    }
  }

  return fixtures;
}
