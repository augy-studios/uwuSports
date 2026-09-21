/* GET /api/search?q=...

   Teams, drivers and competitions across every configured source. Results
   are what the favourites star attaches to.

   Cached at the metadata TTL, 24 hours: a team's name does not change,
   and searching is the easiest way for one curious person to burn
   football-data's 10 per minute for everybody. */

import { cached, cacheKey, TTL } from "./_lib/cache.js";
import { ok, fail, methodGuard, queryOf } from "./_lib/respond.js";

import * as jolpica from "./_lib/sources/jolpica.js";
import * as balldontlie from "./_lib/sources/balldontlie.js";
import * as footballdata from "./_lib/sources/footballdata.js";
import * as thesportsdb from "./_lib/sources/thesportsdb.js";

const MIN_LENGTH = 2;
const MAX_RESULTS = 30;

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  const query = String(queryOf(req).q || "").trim();

  if (query.length < MIN_LENGTH) {
    return fail(res, 400, `Type at least ${MIN_LENGTH} characters to search.`);
  }

  try {
    const result = await cached(cacheKey(["search", query]), TTL.metadata, () => collect(query));
    return ok(res, result);
  } catch (cause) {
    return fail(res, 502, cause?.message || "Search could not reach any source.");
  }
}

async function collect(query) {
  const tasks = [
    { name: "Formula 1", run: () => jolpica.searchDrivers(query) },
    { name: "Other sports", run: () => thesportsdb.searchTeams(query) },
  ];

  if (balldontlie.isConfigured()) {
    tasks.push({ name: "NBA", run: () => balldontlie.searchTeams(query) });
  }
  if (footballdata.isConfigured()) {
    tasks.push({ name: "Football", run: () => footballdata.searchTeams(query) });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));

  let results = [];
  const notes = [];

  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") results = results.concat(outcome.value || []);
    else notes.push({ source: tasks[i].name, reason: outcome.reason?.message || "unavailable" });
  });

  /* An exact prefix match is almost always what somebody meant. */
  const needle = query.toLowerCase();
  results.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.name.localeCompare(b.name);
  });

  return { query, results: results.slice(0, MAX_RESULTS), notes };
}
