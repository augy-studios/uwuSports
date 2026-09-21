/* The server's copy of the internal fixture shape. Kept in step with
   main-site/js/normalise.js by hand; they are two runtimes, and the site
   has no build step to share a module across them.

   Every adapter returns this and nothing else:
     { sport, competition, homeName, awayName, homeScore, awayScore,
       status, startTime, venue }

   Null means the source does not carry that value. Never guess one. */

export function makeFixture(values = {}) {
  return {
    id: values.id ?? null,
    sport: values.sport ?? null,
    competition: values.competition ?? null,
    homeName: values.homeName ?? null,
    awayName: values.awayName ?? null,
    homeScore: values.homeScore ?? null,
    awayScore: values.awayScore ?? null,
    status: values.status ?? "unknown",
    startTime: values.startTime ?? null,
    venue: values.venue ?? null,
    // Additive fields, not part of the shared contract.
    source: values.source ?? null,
    sourceTimezone: values.sourceTimezone ?? null,
    delayed: values.delayed ?? false,
    homeBadge: values.homeBadge ?? null,
    awayBadge: values.awayBadge ?? null,
    extra: values.extra ?? null,
  };
}

/* Each source spells its statuses differently. This is the only place that
   mapping lives, so the UI never sees an upstream vocabulary. */
export function mapStatus(raw, { finishedWords = [], liveWords = [] } = {}) {
  if (!raw) return "unknown";

  const value = String(raw).toLowerCase();

  const finished = ["final", "finished", "ft", "full-time", "post", "completed", ...finishedWords];
  const live = ["live", "in progress", "inprogress", "in_play", "playing", "1st", "2nd", "3rd", "4th", "halftime", ...liveWords];
  const scheduled = ["scheduled", "pre", "not started", "timed", "upcoming"];
  const postponed = ["postponed", "suspended", "delayed", "paused"];
  const cancelled = ["cancelled", "canceled", "abandoned", "awarded"];

  if (finished.some((w) => value.includes(w))) return "finished";
  if (live.some((w) => value.includes(w))) return "live";
  if (postponed.some((w) => value.includes(w))) return "postponed";
  if (cancelled.some((w) => value.includes(w))) return "cancelled";
  if (scheduled.some((w) => value.includes(w))) return "scheduled";

  return "unknown";
}

export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/* Everything downstream renders in the reader's timezone, so every adapter
   has to emit a real ISO instant with an offset, not a local wall clock. */
export function toISO(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function combineDateTime(date, time, fallbackZone = "Z") {
  if (!date) return null;
  const t = time && /^\d{2}:\d{2}/.test(time) ? time : "00:00:00";
  const stamp = `${date}T${t.length === 5 ? `${t}:00` : t}`;
  return toISO(stamp.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(stamp) ? stamp : `${stamp}${fallbackZone}`);
}
