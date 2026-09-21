/* GET /api/health

   Which sources are configured, and how much of API-Sports' daily 100 is
   left. Useful when a section is empty and the question is whether an
   upstream is down or a key was never set.

   Reports configuration only. It reports no key values, and it makes no
   upstream calls other than the API-Sports quota check, which does not
   count against the quota it reports. */

import { ok, methodGuard } from "./_lib/respond.js";
import { hasSupabase } from "./_lib/supabase.js";

import * as balldontlie from "./_lib/sources/balldontlie.js";
import * as footballdata from "./_lib/sources/footballdata.js";
import * as apisports from "./_lib/sources/apisports.js";
import * as espn from "./_lib/sources/espn.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

  const quota = await apisports.remainingQuota().catch(() => null);

  const body = {
    sources: {
      jolpica: { configured: true, note: "No key required." },
      thesportsdb: { configured: true, note: "Public test key, or THESPORTSDB_API_KEY if set." },
      balldontlie: {
        configured: balldontlie.isConfigured(),
        note: balldontlie.isConfigured() ? "Ready." : "BALLDONTLIE_API_KEY is not set, so the NBA section is off.",
      },
      footballdata: {
        configured: footballdata.isConfigured(),
        note: footballdata.isConfigured() ? "Ready." : "FOOTBALL_DATA_API_KEY is not set, so the football section is off.",
      },
      apisports: {
        configured: apisports.isConfigured(),
        quota,
        note: apisports.isConfigured() ? "Secondary source only." : "API_SPORTS_KEY is not set.",
      },
      espn: {
        configured: espn.isEnabled(),
        note: "Unofficial enhancement layer. Never a section's only source.",
      },
    },
    cache: {
      supabase: hasSupabase(),
      note: hasSupabase()
        ? "Shared cache in uwusports_api_cache."
        : "Supabase is not configured, so caching is per instance and in memory only.",
    },
    unavailable: {
      badminton: "No free data source exists.",
      olympics: "No free data source exists.",
    },
  };

  return ok(res, { value: body, fetchedAt: new Date().toISOString() });
}
