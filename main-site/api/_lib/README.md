# _lib

Shared code for the serverless functions. The leading underscore is what
keeps Vercel from routing these as endpoints: anything else in `api/` is
treated as a function.

| File | Job |
|---|---|
| [`cache.js`](cache.js) | The shared cache. Every upstream call goes through `cached()`. |
| [`supabase.js`](supabase.js) | A hand written PostgREST client. Select, upsert, delete. |
| [`http.js`](http.js) | One fetch wrapper: timeout, typed errors, User-Agent. |
| [`normalise.js`](normalise.js) | The fixture shape, status mapping, date coercion. |
| [`sort.js`](sort.js) | Ordering and cross-source deduplication. |
| [`respond.js`](respond.js) | The response envelope and query parsing. |
| [`sources/`](sources/) | One adapter per upstream API. |

## cache.js

One entry point:

```js
const result = await cached(key, ttlSeconds, () => fetchUpstream());
// { value, fetchedAt, stale, source }
```

The fetcher runs only on a miss or an expiry. If it throws and an expired
copy exists, that copy comes back with `stale: true`. If it throws and there
is nothing at all, the error propagates and the endpoint decides.

Two layers. In-memory is L1, saving a Postgres round trip within one warm
instance and becoming the entire cache when Supabase is unset. Supabase is
L2 and is the one that matters, because Vercel functions do not share memory
and a cold start would otherwise go straight to an upstream that allows 100
requests a day.

Build keys with `cacheKey(["today", date])` rather than string concatenation,
so casing and separators stay consistent.

## supabase.js

Hand written rather than pulling in `@supabase/supabase-js`, because this
project has no build step and needs exactly three verbs. It speaks PostgREST
over `fetch` with the service role key.

`hasSupabase()` is false when either variable is unset, and **every caller
must handle that**. The site is expected to deploy and serve before anybody
has configured Postgres.

The service role key bypasses row level security. It never reaches the
browser, and nothing here should ever be imported from a client module.

## http.js

Always use `getJson()` rather than bare `fetch` for an upstream. It gives
you a timeout, so a hanging API cannot hold an invocation open until the
platform kills it, and an `UpstreamError` carrying which source failed,
which is what the cache layer logs when it decides to serve stale.

## normalise.js

The server's copy of the fixture shape, kept in step with
`main-site/js/normalise.js` by hand. They are two runtimes and there is no
build step to share a module between them, so **a change to one needs the
same change to the other.**

`mapStatus()` is the only place upstream status vocabularies are translated.
Adding a source means adding its words there, not branching at the call
site.
