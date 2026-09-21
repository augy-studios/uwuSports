/* GET /api/fixture/:sport/:id

   One fixture in full: score, status, venue, the source timezone the
   detail view shows, and the per-sport extras. Box score for the NBA,
   race results for Formula 1, half time and officials for football.

   The extras are the reason this is a separate endpoint rather than a
   filter over the list: they cost an extra upstream call each, and paying
   that for every card on the dashboard would exhaust a daily quota in an
   afternoon. */

import { cached, cacheKey, TTL } from "../../_lib/cache.js";
import { ok, fail, methodGuard } from "../../_lib/respond.js";

import * as jolpica from "../../_lib/sources/jolpica.js";
import * as balldontlie from "../../_lib/sources/balldontlie.js";
import * as footballdata from "../../_lib/sources/footballdata.js";
import * as thesportsdb from "../../_lib/sources/thesportsdb.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  const sport = String(req.query?.sport || "").toLowerCase();
  const id = String(req.query?.id || "");

  if (!sport || !id) return fail(res, 400, "A sport and a fixture id are both required.");

  const loader = LOADERS[sport];
  if (!loader) return fail(res, 404, `uwuSports has no ${sport} fixtures.`);

  /* A finished fixture never changes, so it could be cached for a day. It
     is not worth branching on: the live TTL is short and a detail view is
     opened once, not polled. */
  try {
    const result = await cached(cacheKey(["fixture", sport, id]), TTL.live, () => loader(id));

    if (!result.value) return fail(res, 404, "That fixture could not be found.");

    return ok(res, result);
  } catch (cause) {
    return fail(res, 502, cause?.message || "That fixture's source could not be reached.");
  }
}

const LOADERS = {
  async formula1(id) {
    /* f1-<season>-<round> */
    const [, season, round] = String(id).split("-");
    if (!season || !round) return null;

    const fixture = await jolpica.fetchResults(season, round);
    return fixture;
  },

  async basketball(id) {
    if (!balldontlie.isConfigured()) return null;

    const fixture = await balldontlie.fetchGame(id);
    if (fixture) {
      try {
        await thesportsdb.decorateBadges([fixture], { limit: 2 });
      } catch {
        /* Cosmetic. */
      }
    }
    return fixture;
  },

  async football(id) {
    if (!footballdata.isConfigured()) return null;
    return footballdata.fetchMatch(id);
  },

  async multi() {
    /* TheSportsDB's per-event lookup is restricted on the free tier, so
       the browse section's cards carry everything it can tell us already. */
    return null;
  },
};
