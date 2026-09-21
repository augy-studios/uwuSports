/* The one internal shape. Every adapter, wherever the fixture came from,
   returns this and nothing else, so the UI never asks which source it is
   looking at:

     { sport, competition, homeName, awayName, homeScore, awayScore,
       status, startTime, venue }

   Plus a few fields the UI needs that are not part of that contract:
   id, sourceId, badges, delayed and sourceTimezone. They are additive; the
   nine above are always present, with null where a source does not carry
   the value. Never invent one. */

export const STATUSES = ["scheduled", "live", "finished", "postponed", "cancelled", "unknown"];

export function emptyFixture() {
  return {
    id: null,
    sport: null,
    competition: null,
    homeName: null,
    awayName: null,
    homeScore: null,
    awayScore: null,
    status: "unknown",
    startTime: null,
    venue: null,
    // Additive, not part of the shared contract.
    source: null,
    sourceTimezone: null,
    delayed: false,
    homeBadge: null,
    awayBadge: null,
    extra: null,
  };
}

export function makeFixture(values) {
  return { ...emptyFixture(), ...values };
}

export function isLive(fixture) {
  return fixture?.status === "live";
}

export function isFinished(fixture) {
  return fixture?.status === "finished";
}

export function hasScore(fixture) {
  return fixture?.homeScore !== null && fixture?.awayScore !== null;
}

/* Sort for a day's list: live first, then upcoming by start time, then
   finished. Somebody opening the app mid-evening wants the thing that is
   happening now at the top, not the thing that finished at lunchtime. */
export function sortFixtures(fixtures) {
  const rank = { live: 0, scheduled: 1, postponed: 2, unknown: 3, finished: 4, cancelled: 5 };

  return [...fixtures].sort((a, b) => {
    const byStatus = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (byStatus !== 0) return byStatus;

    const at = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bt = b.startTime ? new Date(b.startTime).getTime() : 0;
    return at - bt;
  });
}

export function groupBySport(fixtures) {
  const groups = new Map();

  for (const fixture of fixtures) {
    const key = fixture.sport || "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fixture);
  }

  for (const [key, list] of groups) groups.set(key, sortFixtures(list));

  return groups;
}

export function statusLabel(fixture) {
  switch (fixture.status) {
    case "live":
      return fixture.delayed ? "In progress, delayed" : "Live";
    case "finished":
      return "Full time";
    case "postponed":
      return "Postponed";
    case "cancelled":
      return "Cancelled";
    case "scheduled":
      return "Scheduled";
    default:
      return "Status unknown";
  }
}

export const SPORT_LABELS = {
  basketball: "NBA",
  formula1: "Formula 1",
  football: "Football",
  multi: "Other sports",
  badminton: "Badminton",
  olympics: "Olympics",
};

export const SPORT_ICONS = {
  basketball: "basketball",
  formula1: "flag",
  football: "football",
  multi: "globe",
  badminton: "trophy",
  olympics: "trophy",
};

export function sportLabel(id) {
  return SPORT_LABELS[id] || id;
}

export function sportIcon(id) {
  return SPORT_ICONS[id] || "trophy";
}
