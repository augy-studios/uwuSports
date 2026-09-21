/* GET /api/standings/:sport?competition=PL

   League tables and championship standings, where the source publishes
   one. Cached for 30 minutes: a table does not move between matches, and
   football-data only allows 10 requests a minute.

   A sport whose source has no table returns available: false with a
   reason, not an error. */

import { cached, cacheKey, TTL } from "../_lib/cache.js";
import { ok, fail, methodGuard, queryOf } from "../_lib/respond.js";

import * as jolpica from "../_lib/sources/jolpica.js";
import * as balldontlie from "../_lib/sources/balldontlie.js";
import * as footballdata from "../_lib/sources/footballdata.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  const query = queryOf(req);
  const sport = String(req.query?.sport || query.sport || "").toLowerCase();
  const competition = String(query.competition || "").toUpperCase();
  const table = String(query.table || "drivers").toLowerCase();

  const loader = LOADERS[sport];
  if (!loader) {
    return fail(res, 404, `uwuSports has no standings for ${sport}.`);
  }

  try {
    const result = await cached(
      cacheKey(["standings", sport, competition || table]),
      TTL.standings,
      () => loader({ competition, table })
    );
    return ok(res, result);
  } catch (cause) {
    return fail(res, 502, cause?.message || `No standings source could be reached for ${sport}.`);
  }
}

const LOADERS = {
  async formula1({ table }) {
    return table === "constructors"
      ? jolpica.fetchConstructorStandings()
      : jolpica.fetchDriverStandings();
  },

  async basketball() {
    if (!balldontlie.isConfigured()) {
      return { available: false, reason: "NBA standings need BALLDONTLIE_API_KEY on the server.", rows: [] };
    }
    return balldontlie.fetchStandings();
  },

  async football({ competition }) {
    if (!footballdata.isConfigured()) {
      return { available: false, reason: "Football tables need FOOTBALL_DATA_API_KEY on the server.", rows: [] };
    }
    return footballdata.fetchStandings(competition || "PL");
  },

  async multi() {
    /* TheSportsDB's free tier table endpoint is unreliable enough that
       promising one here would be dishonest. */
    return {
      available: false,
      reason: "The multi-sport browse source does not publish tables on its free tier.",
      rows: [],
    };
  },
};
