# api

Vercel serverless functions. Every third party call in uwuSports goes
through here, and none are made from the browser.

Three reasons, all of them load bearing:

1. **API keys stay server side.** A key in a client bundle is a public key.
2. **Rate limits are enforced centrally.** balldontlie allows 60 requests a
   minute and Highlightly allows 100 a *day*. One shared cache in front of
   them is the difference between a working app and a throttled one.
3. **CORS stops being a problem.** Several of these upstreams do not send
   permissive headers, and two of them are not really public APIs at all.

## Endpoints

| Route | Returns |
|---|---|
| `GET /api/today?date=` | Every sport's fixtures for one day, in one list |
| `GET /api/sport/:sport?date=` | One sport. `basketball`, `formula1`, `football`, `multi`, plus the two unavailable ones |
| `GET /api/fixture/:sport/:id` | One fixture in full, with per-sport extras |
| `GET /api/standings/:sport` | League table or championship standings |
| `GET /api/search?q=` | Teams, drivers and competitions across every configured source |
| `GET /api/favourites` | The signed-in reader's starred items |
| `POST /api/favourites` | Add or remove one |
| `GET /api/health` | Which sources are configured, and which sports each covers |

### The response envelope

Every endpoint answers in one shape, so the client parses one thing:

```json
{
  "ok": true,
  "data": {},
  "stale": false,
  "fetchedAt": "2026-09-22T18:04:00.000Z",
  "source": "upstream"
}
```

`stale` is the field that matters. **A stale response is still a 200 with
real data in it**, served because an upstream failed and the cache had the
last good copy. The client renders it and shows the saved-data indicator.
Only a total miss, nothing upstream and nothing cached, is an error.

## Layout

| Path | What it is |
|---|---|
| [`_lib/cache.js`](_lib/cache.js) | The shared cache. Every upstream call goes through `cached()`. |
| [`_lib/supabase.js`](_lib/supabase.js) | A hand written PostgREST client. Two verbs, no dependency. |
| [`_lib/http.js`](_lib/http.js) | One fetch wrapper: timeout, descriptive errors, User-Agent. |
| [`_lib/normalise.js`](_lib/normalise.js) | The server's copy of the fixture shape and the status mapping. |
| [`_lib/sort.js`](_lib/sort.js) | Ordering and cross-source deduplication. |
| [`_lib/sources/`](_lib/sources/) | One adapter per API. |

Vercel treats any file in `api/` as a function, so shared code lives under
`_lib/`; the leading underscore keeps it from being routed.

## Caching

Vercel functions do not share memory between invocations, so a per-instance
`Map` would let a cold start hammer an upstream that allows 100 requests a
day. The durable cache is Postgres. In-memory sits in front of it as an L1,
and becomes the whole cache when Supabase is not configured.

| Kind | TTL | Why |
|---|---|---|
| Live fixtures | 45s | Faster than the fastest source updates anyway |
| Today's schedule | 5m | Fixture lists change rarely within a day |
| Standings | 30m | A table does not move between matches |
| Metadata, badges, profiles | 24h | Effectively immutable |

Override any of them with the `CACHE_TTL_*` variables in `.env.example`.

An expired entry stays *servable* for seven days. If an upstream fails and
we hold an expired copy, that copy is returned with `stale: true` rather
than failing the view.

### The table

The SQL lives in [`../../migrations/`](../../migrations/), not here, so
there is one copy of it instead of two that drift apart. Apply
`0001_uwusports_api_cache.sql` and you are done.

Two things about it worth knowing without opening the file:

- **Row level security is on, with no policy, on purpose.** Only the service
  role key touches this table and that key bypasses RLS, so a leaked anon
  key reaches nothing here.
- **Expired rows are harmless.** Every read checks `expires_at`, so they
  cost storage and nothing else. `0002` adds a prune function for them.

Without the table, the functions fall back to per instance in-memory
caching and log a warning. The site works; it just hits the upstreams
harder.

### Table naming

`uwusports_api_cache` carries the app prefix because this app owns it.
Favourites go in **`uwu_user_data`**, without the prefix, because it is the
shared suite table: a favourite is user data that belongs to the person
across every UwU app, not to this one. Same for `uwu_users`, `uwu_sessions`
and `uwu_user_prefs`.

## Adapters

Each source in [`_lib/sources/`](_lib/sources/) is swappable. They all
return the same normalised fixture, so replacing one touches that file and
nothing else:

```js
{ sport, competition, homeName, awayName,
  homeScore, awayScore, status, startTime, venue }
```

Plus additive fields the UI uses: `id`, `source`, `sourceTimezone`,
`delayed`, `homeBadge`, `awayBadge` and `extra`.

`null` means the source does not carry that value. **Never guess one.**

`status` is always one of `scheduled`, `live`, `finished`, `postponed`,
`cancelled` or `unknown`. Each upstream spells these differently, and
`mapStatus()` in `_lib/normalise.js` is the only place that mapping lives.

### Honesty rules

These are behavioural, not stylistic:

- **A delayed source is labelled delayed.** balldontlie refreshes about
  every 10 minutes and football-data delays scores on the free tier, so
  every fixture from either carries `delayed: true` and the card says so.
  Calling a 10 minute old score "live" is the one dishonest thing this app
  could do.
- **TheSportsDB is never a live scores source.** Livescores are premium
  only there, so an event with a score is treated as finished and one
  without as scheduled.
- **ESPN never serves a section alone.** It is undocumented and unsupported.
  It only enriches fixtures a primary source already returned, matching on
  team names, and any failure leaves them untouched. `ESPN_ENABLED=0`
  switches it off.
- **An unconfigured source says so.** Without its key, a section returns
  `available: false` and a reason. It does not return invented fixtures.
- **Badminton and Olympics return an empty list with a reason.** No free
  data source exists for either. Nothing here scrapes BWF or
  tournamentsoftware.com.

## Adding a source

1. Write `_lib/sources/yours.js`, exporting `fetchByDate(date)` and an
   `isConfigured()` if it needs a key.
2. Return normalised fixtures via `makeFixture()`. Never leak the upstream's
   own shape past this file.
3. Register it in the relevant endpoint's task list, inside the
   `Promise.allSettled` so a failure degrades without cascading.
4. Add its variable to `.env.example`, including what happens when unset.
5. Pick the right TTL. When in doubt, the longer one.
