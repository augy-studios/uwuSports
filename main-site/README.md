# main-site

The deployable site. Vercel's root directory is set to this folder, which is
why `api/` sits inside it rather than at the repo root.

Everything here ships as written. There is no build step, so the file you
edit is the file a reader gets.

## Layout

| Path | What it is |
|---|---|
| [`index.html`](index.html) | The app. Its `<head>` is the template every other page in the repo copies. |
| [`offline.html`](offline.html) | Shown only when the reader is offline and nothing has been cached for the view yet. |
| [`404.html`](404.html) / [`404.css`](404.css) | Not found. Keeps its own fixed underwater palette rather than the theme tokens. |
| [`css/`](css/) | `theme.css` for the token system, `style.css` for the app. |
| [`js/`](js/) | The client, as ES modules. |
| [`api/`](api/) | Vercel serverless functions and the adapters behind them. |
| [`sw.js`](sw.js) | Service worker. Read the header comment before changing it. |
| [`manifest.json`](manifest.json) | PWA manifest, app id `org.uwuapps.sports`. |
| [`.env.example`](.env.example) | Every environment variable, with what happens when it is unset. |
| [`images/`](images/) | Manifest screenshots. |
| [`.well-known/`](.well-known/) | Android app association. |

## The client

Ten modules, each with one job:

| Module | Job |
|---|---|
| `app.js` | Boot, routing, wiring. The only module that touches more than one concern. |
| `theme.js` | The 7 swatch and light/dark/time system. Copied from the spec; change `APP_KEY` only. |
| `icons.js` | Every icon in the app, as inline SVG. |
| `ui.js` | Icon hydration, modals, escaping, and all time formatting. |
| `update.js` | Registers the service worker and draws the update and offline bar. |
| `api.js` | Talks to `/api`, and falls back to IndexedDB when it cannot. |
| `store.js` | IndexedDB: cached payloads and offline favourites. |
| `normalise.js` | The internal fixture shape, sorting and grouping. |
| `favourites.js` | Starred teams, drivers and competitions, with the sync interface. |
| `views.js` | All rendering. Takes normalised fixtures, returns markup. |

### Routing

Hash based, on purpose. The app has to work from the cached shell with no
server round trip, and a path-based route offline means asking a service
worker to invent a navigation response for a URL it has never seen.

### Refresh

Live fixtures poll every 60 seconds, and only while something is actually
live. The server caches live responses for 45 seconds, so polling faster
returns the same bytes and costs battery. Polling stops entirely when the
tab is offline, and a visible last-updated stamp sits above the fixture
list with a manual refresh button beside it. Nothing ever auto-reloads the
page.

### Timezones

Every start time renders in the reader's own timezone, through
`toLocaleString`. The source timezone appears on the detail view only, so
somebody checking a start time against a broadcast can see both. Nothing
asks for, sends or stores a location.

## Offline

Four caches, split by what each holds and how long it should live:

| Cache | Holds | Versioned |
|---|---|---|
| `uwusports-shell-<version>` | App shell, precached on install | Yes |
| `uwusports-icons-<version>` | Team badges and artwork | Yes |
| `uwusports-fonts-<version>` | Jua from Google Fonts | Yes |
| `uwusports-payloads` | Last good response per API endpoint | **No** |

The payload cache is deliberately not versioned. It holds what an offline
reader sees, and throwing it away on every deploy would send somebody
offline to an empty app for no reason.

A cached API response comes back with `x-uwu-stale: 1`, which is what drives
the stale indicator. Offline shows the last known data with that indicator,
never an error page.

## Changing the service worker

Read the comment at the top of [`sw.js`](sw.js) first. Two rules:

1. `skipWaiting()` and `clients.claim()` appear only inside the message
   handler. Moving either into `install` or `activate` makes a new worker
   activate on its own, which reloads assets under a page still running the
   old JavaScript. That is the bug nobody can reproduce.
2. **Bump `SW_VERSION` on every deploy.** The browser compares the worker
   byte for byte, so an unchanged file means no update prompt, however much
   else has moved.

`node scripts/check-sw.mjs` from the repo root enforces the first one.

## Local development

```bash
vercel dev
```

Serving this folder statically also works for everything except `/api`.

The site runs with no environment variables set. See
[`.env.example`](.env.example) for what each one turns on.

## Deploying

Vercel, with the root directory set to `main-site`. Set the environment
variables in the dashboard, then push.

Checklist before a deploy:

- [ ] `SW_VERSION` in `sw.js` bumped
- [ ] `node scripts/check-sw.mjs` passes
- [ ] Theme still defaults to light on a fresh profile with the OS in dark
- [ ] Any new SQL applied from [`../migrations/`](../migrations/)
