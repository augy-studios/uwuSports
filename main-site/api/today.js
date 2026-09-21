/* GET /api/today?date=YYYY-MM-DD

   Today's fixtures and results across every active sport, normalised into
   one list. The dashboard groups them by sport on the client.

   Every source is queried in parallel and settled independently: a source
   that is unconfigured, rate limited or down contributes nothing and is
   reported in `notes`, without failing the whole dashboard. That is
   the difference between a bad afternoon for one API and a broken app. */

import { cached, cacheKey, TTL } from "./_lib/cache.js";
import { ok, fail, methodGuard, queryOf, dateParam } from "./_lib/respond.js";
import { sortFixtures } from "./_lib/sort.js";

import * as jolpica from "./_lib/sources/jolpica.js";
import * as balldontlie from "./_lib/sources/balldontlie.js";
import * as footballdata from "./_lib/sources/footballdata.js";
import * as thesportsdb from "./_lib/sources/thesportsdb.js";
import * as espn from "./_lib/sources/espn.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  const date = dateParam(queryOf(req));

  try {
    const result = await cached(cacheKey(["today", date]), TTL.schedule, () => collect(date));
    return ok(res, result);
  } catch (cause) {
    return fail(res, 502, cause?.message || "No source could be reached for today.");
  }
}

async function collect(date) {
  const notes = [];

  const tasks = [
    { name: "Formula 1", run: () => jolpica.fetchByDate(date) },
    {
      name: "NBA",
      run: () => balldontlie.fetchByDate(date),
      skip: !balldontlie.isConfigured() && "BALLDONTLIE_API_KEY is not set",
    },
    {
      name: "Football",
      run: () => footballdata.fetchByDate(date),
      skip: !footballdata.isConfigured() && "FOOTBALL_DATA_API_KEY is not set",
    },
    { name: "Other sports", run: () => thesportsdb.fetchByDate(date) },
  ];

  const settled = await Promise.allSettled(
    tasks.map((task) => {
      if (task.skip) return Promise.reject(new Error(task.skip));
      return task.run();
    })
  );

  let fixtures = [];

  settled.forEach((outcome, i) => {
    const task = tasks[i];

    if (outcome.status === "fulfilled") {
      fixtures = fixtures.concat(outcome.value || []);
    } else {
      notes.push({ sport: task.name, reason: outcome.reason?.message || "unavailable" });
    }
  });

  /* The ESPN enhancement layer, per sport, best effort. Never the sole
     source for anything, and a failure leaves the fixtures untouched. */
  if (espn.isEnabled()) {
    await Promise.allSettled([
      espn.enhance(fixtures.filter((f) => f.sport === "basketball"), "basketball"),
      espn.enhance(fixtures.filter((f) => f.sport === "football"), "football"),
    ]);
  }

  /* Badges last, bounded, and never allowed to fail the response. */
  try {
    await thesportsdb.decorateBadges(fixtures);
  } catch {
    /* Cosmetic only. */
  }

  return { date, fixtures: sortFixtures(fixtures), notes };
}
