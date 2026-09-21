/* GET /api/health

   Which sources are configured. Useful when a section is empty and the
   question is whether an upstream is down or a key was never set.

   Reports configuration only. It reports no key values and makes no
   upstream calls at all, so hitting it is free and cannot itself consume
   any source's quota. */

import { ok, methodGuard } from "./_lib/respond.js";
import { hasSupabase } from "./_lib/supabase.js";

import * as balldontlie from "./_lib/sources/balldontlie.js";
import * as footballdata from "./_lib/sources/footballdata.js";
import * as highlightly from "./_lib/sources/highlightly.js";
import * as sportsapipro from "./_lib/sources/sportsapipro.js";
import * as espn from "./_lib/sources/espn.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;

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
      highlightly: {
        configured: highlightly.isConfigured(),
        sports: highlightly.GAP_SPORTS,
        note: highlightly.isConfigured()
          ? "Secondary source, 100 requests a day. Gap sports only."
          : "HIGHLIGHTLY_API_KEY is not set, so hockey, rugby and the other gap sports are off.",
      },
      sportsapipro: {
        configured: sportsapipro.isConfigured(),
        note: sportsapipro.isConfigured()
          ? "Badminton. 100 requests a day, shared across the provider."
          : "SPORTSAPIPRO_API_KEY is not set, so the badminton section is off.",
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
      olympics: "No free data source exists.",
    },
  };

  return ok(res, { value: body, fetchedAt: new Date().toISOString() });
}
