/* One response envelope for every endpoint, so the client only ever parses
   one shape:

     { ok, data, stale, fetchedAt, source, error }

   stale is the important one. A stale response is still a 200 with real
   data in it; the client renders it and shows the saved-data indicator.
   Only a total miss, nothing upstream and nothing cached, is an error. */

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  /* The service worker holds the durable client-side copy, so the browser
     cache is told not to keep its own and the CDN keeps a short one. The
     stale-while-revalidate window matches the stale grace in cache.js. */
  if (status === 200) {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=600");
  } else {
    res.setHeader("Cache-Control", "no-store");
  }

  res.end(JSON.stringify(body));
}

export function ok(res, result, extra = {}) {
  json(res, 200, {
    ok: true,
    data: result.value ?? result.data ?? null,
    stale: Boolean(result.stale),
    fetchedAt: result.fetchedAt || new Date().toISOString(),
    source: result.source || null,
    ...extra,
  });
}

export function fail(res, status, message, extra = {}) {
  json(res, status, {
    ok: false,
    data: null,
    stale: false,
    error: message,
    ...extra,
  });
}

/* Every endpoint is a GET unless it says otherwise. */
export function methodGuard(req, res, allowed = ["GET"]) {
  if (allowed.includes(req.method)) return true;

  res.setHeader("Allow", allowed.join(", "));
  fail(res, 405, `This endpoint accepts ${allowed.join(" and ")}.`);
  return false;
}

export function queryOf(req) {
  if (req.query) return req.query;
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  return Object.fromEntries(url.searchParams);
}

export function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

/* A date from the query string, validated. An unparseable one falls back
   to today rather than being passed through to an upstream. */
export function dateParam(query) {
  const raw = query?.date;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayISODate();
}
