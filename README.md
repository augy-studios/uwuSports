# uwuSports

Live sports scores, schedules and standings, as a PWA. Part of the UwU Apps
suite, deployed at `sports.uwuapps.org`.

Formula 1, the NBA, football and a general multi-sport browse, all normalised
into one shape so the interface does not care which API a fixture came from.
Works offline, showing the last data it saved with a clear stale indicator
rather than an error page.

## What is here

| Path | What it holds |
|---|---|
| [`main-site/`](main-site/) | The whole deployable site. Vercel's root directory is set to this, which is why `api/` lives inside it. |
| [`migrations/`](migrations/) | Supabase SQL. Outside `main-site` on purpose, so schema is never deployed or served over HTTP. |
| [`scripts/`](scripts/) | Repo checks that are worth running in CI. |
| `uwuapps-theme.md` | The theme system spec. Source of truth for every colour, token and mode in the app. |
| `update-bar-spec.md` | The update prompt bar spec. Source of truth for how a new deploy reaches a reader. |
| `uwuapps-retrofit-time-mode.md` | The retrofit prompt for time-based mode. Already applied here. |

## Stack

Vanilla HTML, CSS and JavaScript. No framework, no bundler, no build step.
The files that ship are the files in the repo, which is the point: a reader
gets the app, and a maintainer gets a stack traceable with nothing but a
browser.

- **Hosting:** Vercel, with serverless functions in `main-site/api/`.
- **Database:** Supabase, the shared uwuapps project, for the upstream
  response cache and for favourites once a reader is signed in.
- **Offline:** a service worker with a precached app shell and a per-view
  payload cache, plus IndexedDB for favourites and the last good payload.

## Running it locally

```bash
npm i -g vercel        # once
cd main-site
vercel dev
```

The site boots with no environment variables at all. Formula 1 and the
multi-sport browse work immediately, since neither source needs a key. The
NBA and football sections report themselves as unconfigured until you set
their keys, rather than showing invented fixtures. Copy
[`main-site/.env.example`](main-site/.env.example) to `main-site/.env.local`
and fill in what you want.

Serving `main-site/` with any static server also works for everything except
the API, since there is nothing to compile.

### The database

Optional, and the site does not wait for it. Apply
[`migrations/0001_uwusports_api_cache.sql`](migrations/0001_uwusports_api_cache.sql)
in the Supabase SQL editor to get the shared cache. Without it, each
serverless instance caches in memory on its own and logs a warning, which
works but hits the upstreams harder. See
[`migrations/README.md`](migrations/README.md).

## Checks

```bash
node scripts/check-sw.mjs
```

Verifies the one invariant that cannot be caught by reading the diff: that
`skipWaiting()` and `clients.claim()` appear nowhere in the service worker
outside its message handler. That single line is what silently turns the
update bar back into a takeover that reloads somebody's page mid-session.

## Data sources

Only free-forever APIs, none of which need a card. Each sits behind an
adapter in [`main-site/api/_lib/sources/`](main-site/api/_lib/sources/) and
returns one normalised shape, so any of them can be swapped without the UI
noticing.

| Source | Used for | Key | Limit |
|---|---|---|---|
| Jolpica-F1 | All Formula 1 | None | 200/hour |
| balldontlie | NBA | Free, no card | ~60/minute |
| TheSportsDB | Badges, artwork, multi-sport browse | Public test key | 30/minute |
| football-data.org | Football | Free, no card | 10/minute |
| API-Sports.io | Secondary, gap filling only | Free, no card | 100/**day** per sport |
| ESPN | Live score enhancement only | None | Undocumented |

Two honest gaps, both visible in the app rather than hidden:

- **Badminton.** No free API exists. The BWF publishes none, and the
  community scrapers have been IP-banned. The section ships behind a
  coming-soon state that says exactly that. Nothing scrapes BWF or
  tournamentsoftware.com.
- **Olympics.** Every provider gates the data behind a paid plan or a sales
  conversation. Same treatment.

Neither ships placeholder fixtures. An empty section that explains itself is
worth more than a full one that is lying.

## Where things are hosted

**Everything runs on Vercel. Nothing here needs the Debian VPS.**

Every upstream call is a short-lived HTTPS request that fits comfortably in
a serverless function, the cache is Postgres rather than a local disk, and
there is no long-running process, no cron, no websocket and no scraper. The
one thing that would have justified the VPS, a poller keeping its own live
feed warm, is deliberately not built: the free tiers' rate limits are lower
than any useful poll interval, so the cache TTLs do that job instead.

If that ever changes, the trigger is a paid source with a websocket feed.
That would want a small always-on process on the VPS pushing into Supabase,
with Vercel still serving reads. Until then, adding the VPS would add a
machine to maintain and nothing else.

## Conventions

These are enforced by review rather than by a linter, and they are not
stylistic preferences:

- **No emoji.** Every icon is inline SVG from `main-site/js/icons.js`.
- **No em dashes** in copy, comments or docs.
- **No gradients, orbs or blobs.** The background is one flat colour derived
  from the active theme.
- **No hardcoded hex in component CSS.** Reference a token, so it stays
  correct across all 14 theme combinations. The one exception is the footer
  heart, which must read as a heart whatever the brand swatch is.
- **Light mode is the default**, regardless of the operating system's
  preference. Dark is opt in.
- **Bump `SW_VERSION`** in `main-site/sw.js` on every deploy that changes
  anything the worker serves. A version left alone is an update prompt
  nobody ever sees.

## Licence

[MIT](LICENSE). See also the [code of conduct](CODE_OF_CONDUCT.md).
