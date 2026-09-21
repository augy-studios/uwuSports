/* GET /api/sport/:sport?date=YYYY-MM-DD

   One sport's fixtures. :sport is the internal id, not an upstream name:
   basketball, formula1, football or multi.

   badminton and olympics are answered here too, with an explicit
   unavailable payload instead of a 404, so the client can render the
   honest coming-soon state instead of an error. No placeholder fixtures
   are ever returned for either. */

import { cached, cacheKey, TTL } from "../_lib/cache.js";
import { ok, fail, methodGuard, queryOf, dateParam } from "../_lib/respond.js";
import { sortFixtures, dedupe } from "../_lib/sort.js";

import * as jolpica from "../_lib/sources/jolpica.js";
import * as balldontlie from "../_lib/sources/balldontlie.js";
import * as footballdata from "../_lib/sources/footballdata.js";
import * as thesportsdb from "../_lib/sources/thesportsdb.js";
import * as highlightly from "../_lib/sources/highlightly.js";
import * as espn from "../_lib/sources/espn.js";

/* The two gaps, stated and not hidden. Neither has a free data source
   that exists, so neither is stubbed with fake fixtures. */
const UNAVAILABLE = {
  badminton: {
    reason:
      "No free badminton data source currently exists. The BWF publishes no public API, and the community projects that filled the gap have been blocked.",
  },
  olympics: {
    reason:
      "Every Olympic data provider gates its feed behind a paid plan or a sales conversation, and uwuSports only uses sources that are free forever.",
  },
};

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  const query = queryOf(req);
  const sport = String(req.query?.sport || query.sport || "").toLowerCase();
  const date = dateParam(query);

  if (UNAVAILABLE[sport]) {
    return ok(
      res,
      { value: { sport, fixtures: [], available: false, reason: UNAVAILABLE[sport].reason }, fetchedAt: new Date().toISOString() }
    );
  }

  const collector = COLLECTORS[sport];
  if (!collector) return fail(res, 404, `uwuSports does not have a ${sport} section.`);

  try {
    const result = await cached(cacheKey(["sport", sport, date]), TTL.schedule, () =>
      collector(date)
    );
    return ok(res, result);
  } catch (cause) {
    return fail(res, 502, cause?.message || `No source could be reached for ${sport}.`);
  }
}

const COLLECTORS = {
  async formula1(date) {
    /* The F1 calendar is sparse, so a day-scoped view is empty most of the
       year. Showing the season around today is the useful answer. */
    const [onDate, upcoming] = await Promise.all([
      jolpica.fetchByDate(date).catch(() => []),
      jolpica.fetchUpcoming().catch(() => []),
    ]);

    return { sport: "formula1", fixtures: sortFixtures(dedupe([...onDate, ...upcoming])), notes: [] };
  },

  async basketball(date) {
    if (!balldontlie.isConfigured()) {
      return {
        sport: "basketball",
        fixtures: [],
        available: false,
        reason: "The NBA section needs BALLDONTLIE_API_KEY to be set on the server.",
      };
    }

    const fixtures = await balldontlie.fetchByDate(date);
    if (espn.isEnabled()) await espn.enhance(fixtures, "basketball").catch(() => {});

    try {
      await thesportsdb.decorateBadges(fixtures);
    } catch {
      /* Cosmetic. */
    }

    return { sport: "basketball", fixtures: sortFixtures(fixtures), notes: [] };
  },

  async football(date) {
    if (!footballdata.isConfigured()) {
      return {
        sport: "football",
        fixtures: [],
        available: false,
        reason: "The football section needs FOOTBALL_DATA_API_KEY to be set on the server.",
      };
    }

    const fixtures = await footballdata.fetchByDate(date);
    if (espn.isEnabled()) await espn.enhance(fixtures, "football").catch(() => {});

    return { sport: "football", fixtures: sortFixtures(fixtures), notes: [] };
  },

  async multi(date) {
    /* TheSportsDB carries the browse section on its own. Highlightly adds
       the sports it covers better, when a key is set, and contributes
       nothing when one is not. Settled independently so the section still
       renders if either is down. */
    const [tsdb, gaps] = await Promise.allSettled([
      thesportsdb.fetchByDate(date),
      highlightly.fetchGapSports(date),
    ]);

    const fixtures = [
      ...(tsdb.status === "fulfilled" ? tsdb.value : []),
      ...(gaps.status === "fulfilled" ? gaps.value : []),
    ];

    const notes = [];
    if (tsdb.status === "rejected") {
      notes.push({ source: "TheSportsDB", reason: tsdb.reason?.message || "unavailable" });
    }
    if (gaps.status === "rejected") {
      notes.push({ source: "Highlightly", reason: gaps.reason?.message || "unavailable" });
    }

    /* Both sources can carry the same match, so dedupe picks the richer
       record instead of showing it twice. */
    return { sport: "multi", fixtures: sortFixtures(dedupe(fixtures)), notes };
  },
};
