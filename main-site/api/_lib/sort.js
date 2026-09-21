/* Ordering for a day's fixture list, shared by every endpoint that returns
   more than one. Live first, then upcoming by start time, then finished.

   Somebody opening the app mid-evening wants the thing happening now at
   the top, not the thing that finished at lunchtime. */

const RANK = {
  live: 0,
  scheduled: 1,
  postponed: 2,
  unknown: 3,
  finished: 4,
  cancelled: 5,
};

export function sortFixtures(fixtures) {
  return [...fixtures].sort((a, b) => {
    const byStatus = (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;

    const at = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bt = b.startTime ? new Date(b.startTime).getTime() : 0;
    return at - bt;
  });
}

/* Deduplicate across sources. Two adapters can return the same match, for
   instance football-data and TheSportsDB both carrying a Premier League
   fixture. The richer record wins: the one with a score, then the one with
   badges. */
export function dedupe(fixtures) {
  const seen = new Map();

  for (const fixture of fixtures) {
    const key = [
      fixture.sport,
      fixture.startTime?.slice(0, 10),
      normalise(fixture.homeName),
      normalise(fixture.awayName),
    ].join("|");

    const existing = seen.get(key);
    if (!existing || score(fixture) > score(existing)) seen.set(key, fixture);
  }

  return [...seen.values()];
}

function normalise(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(fc|afc|cf|sc|club|the)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function score(fixture) {
  let value = 0;
  if (fixture.homeScore !== null && fixture.awayScore !== null) value += 4;
  if (fixture.homeBadge || fixture.awayBadge) value += 2;
  if (fixture.venue) value += 1;
  if (!fixture.delayed) value += 1;
  return value;
}
