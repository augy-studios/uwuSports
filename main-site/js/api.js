/* The browser's side of the data layer. Nothing here talks to a third party
   API directly: every call goes to main-site/api/, which holds the keys,
   enforces the rate limits centrally and sidesteps CORS.

   Three things can come back and the UI has to tell them apart:
     fresh   the upstream answered just now
     stale   the upstream failed and the server served its last good copy,
             or we are offline and read our own IndexedDB copy
     empty   nothing cached and nothing reachable, which is the only case
             that shows an error rather than data */

import { savePayload, readPayload } from "./store.js";

const API_BASE = "/api";

export class ApiResult {
  constructor({ data, stale, fetchedAt, source, error }) {
    this.data = data ?? null;
    this.stale = Boolean(stale);
    this.fetchedAt = fetchedAt || null;
    this.source = source || null;
    this.error = error || null;
  }

  get ok() {
    return this.data !== null;
  }
}

function cacheKey(path, params) {
  const search = new URLSearchParams(params || {}).toString();
  return search ? `${path}?${search}` : path;
}

/* One request. On any failure, fall back to the IndexedDB copy of the same
   key and mark it stale. An offline reader sees the last known data with a
   clear indicator, which is the requirement, not an error page. */
export async function request(path, params = {}, { signal } = {}) {
  const key = cacheKey(path, params);
  const url = new URL(`${API_BASE}${key}`, window.location.origin);

  try {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });

    /* The service worker stamps a served-from-cache response rather than
       letting it look fresh. */
    const swStale = response.headers.get("x-uwu-stale") === "1";

    if (!response.ok && response.status !== 200) {
      const body = await safeJson(response);
      /* The server itself reports staleness in the body when an upstream
         failed but it still had something to serve. */
      if (body?.data) {
        await savePayload(key, body.data);
        return new ApiResult({
          data: body.data,
          stale: true,
          fetchedAt: body.fetchedAt || new Date().toISOString(),
          source: body.source,
        });
      }
      throw new Error(body?.error || `Request failed with ${response.status}`);
    }

    const body = await response.json();

    if (body?.ok === false && !body?.data) {
      throw new Error(body.error || "The server could not serve this view.");
    }

    const data = body?.data ?? body;
    const stale = swStale || Boolean(body?.stale);
    const fetchedAt = body?.fetchedAt || new Date().toISOString();

    await savePayload(key, data);

    return new ApiResult({ data, stale, fetchedAt, source: body?.source });
  } catch (cause) {
    if (cause?.name === "AbortError") throw cause;

    const cached = await readPayload(key);

    if (cached) {
      return new ApiResult({
        data: cached.data,
        stale: true,
        fetchedAt: cached.fetchedAt,
      });
    }

    return new ApiResult({ data: null, stale: false, error: humanError(cause) });
  }
}

function humanError(cause) {
  if (!navigator.onLine) {
    return "You are offline, and uwuSports has not saved this view yet.";
  }
  return cause?.message || "Something went wrong reaching uwuSports.";
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/* ---- the endpoints the UI calls ---- */

export function getToday(params = {}) {
  return request("/today", params);
}

export function getSport(sport, params = {}) {
  return request(`/sport/${sport}`, params);
}

export function getFixture(sport, id) {
  return request(`/fixture/${sport}/${encodeURIComponent(id)}`);
}

export function getStandings(sport, params = {}) {
  return request(`/standings/${sport}`, params);
}

export function search(query) {
  return request("/search", { q: query });
}
