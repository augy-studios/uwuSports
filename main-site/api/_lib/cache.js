/* The shared cache in front of every upstream call.

   Vercel functions do not share in-memory state between invocations, so a
   per-instance Map would let a cold start hammer an upstream that allows
   100 requests a day. The durable cache is a Supabase table,
   uwusports_api_cache, keyed by endpoint and query.

   In-memory sits in front of it as an L1: within one warm instance it
   saves a Postgres round trip, and it is the entire cache when Supabase is
   not configured, which keeps the app working with no database at all.

   On upstream failure we serve stale and say so, rather than failing the
   view. The UI needs to be able to tell a fresh answer from a saved one. */

import { supabase, hasSupabase } from "./supabase.js";

const TABLE = "uwusports_api_cache";

export const TTL = {
  live: Number(process.env.CACHE_TTL_LIVE || 45),
  schedule: Number(process.env.CACHE_TTL_SCHEDULE || 300),
  standings: Number(process.env.CACHE_TTL_STANDINGS || 1800),
  metadata: Number(process.env.CACHE_TTL_METADATA || 86400),
};

const memory = new Map();

/* How long a stale entry stays servable after it expires. A fixture list
   from yesterday is better than an error page, but a month old one is not
   worth the confusion. */
const STALE_GRACE_SECONDS = 60 * 60 * 24 * 7;

function now() {
  return Date.now();
}

function readMemory(key) {
  const hit = memory.get(key);
  if (!hit) return null;

  if (hit.expiresAt > now()) return { ...hit, stale: false };
  if (hit.expiresAt + STALE_GRACE_SECONDS * 1000 > now()) return { ...hit, stale: true };

  memory.delete(key);
  return null;
}

function writeMemory(key, value, ttlSeconds) {
  memory.set(key, {
    value,
    expiresAt: now() + ttlSeconds * 1000,
    fetchedAt: new Date().toISOString(),
  });

  /* A cold instance should not grow without bound if a caller passes
     unbounded keys. */
  if (memory.size > 500) {
    const oldest = [...memory.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) memory.delete(oldest[0]);
  }
}

async function readSupabase(key) {
  if (!hasSupabase()) return null;

  try {
    const { data, error } = await supabase()
      .from(TABLE)
      .select("payload, expires_at, fetched_at")
      .eq("cache_key", key)
      .maybeSingle();

    if (error || !data) return null;

    const expiresAt = new Date(data.expires_at).getTime();
    const fresh = expiresAt > now();
    const servable = expiresAt + STALE_GRACE_SECONDS * 1000 > now();

    if (!servable) return null;

    return { value: data.payload, fetchedAt: data.fetched_at, stale: !fresh };
  } catch (cause) {
    console.warn("[cache] supabase read failed:", cause?.message);
    return null;
  }
}

async function writeSupabase(key, value, ttlSeconds) {
  if (!hasSupabase()) return;

  try {
    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(now() + ttlSeconds * 1000).toISOString();

    await supabase()
      .from(TABLE)
      .upsert(
        { cache_key: key, payload: value, fetched_at: fetchedAt, expires_at: expiresAt },
        { onConflict: "cache_key" }
      );
  } catch (cause) {
    /* A cache write failing is not a reason to fail the request. */
    console.warn("[cache] supabase write failed:", cause?.message);
  }
}

/* The one entry point. Returns { value, fetchedAt, stale, source }.

   fetcher is only called on a miss or an expiry. If it throws and we hold
   an expired copy, that copy comes back with stale: true. If it throws and
   we hold nothing, the error propagates and the endpoint decides. */
export async function cached(key, ttlSeconds, fetcher) {
  const local = readMemory(key);
  if (local && !local.stale) {
    return { value: local.value, fetchedAt: local.fetchedAt, stale: false, source: "memory" };
  }

  const remote = await readSupabase(key);
  if (remote && !remote.stale) {
    writeMemory(key, remote.value, ttlSeconds);
    return { value: remote.value, fetchedAt: remote.fetchedAt, stale: false, source: "supabase" };
  }

  try {
    const value = await fetcher();

    writeMemory(key, value, ttlSeconds);
    await writeSupabase(key, value, ttlSeconds);

    return { value, fetchedAt: new Date().toISOString(), stale: false, source: "upstream" };
  } catch (cause) {
    const fallback = remote || local;

    if (fallback) {
      console.warn(`[cache] upstream failed for ${key}, serving stale:`, cause?.message);
      return {
        value: fallback.value,
        fetchedAt: fallback.fetchedAt,
        stale: true,
        source: "stale",
        error: cause?.message,
      };
    }

    throw cause;
  }
}

export function cacheKey(parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== "")
    .map((p) => String(p).toLowerCase())
    .join(":");
}
