# js

The client, as ES modules. No bundler, so the import graph you read is the
one the browser loads.

## Modules

| Module | Job |
|---|---|
| [`app.js`](app.js) | Boot, hash routing, event wiring, refresh scheduling. The only module that spans concerns. |
| [`theme.js`](theme.js) | The 7 swatch and light/dark/time system. |
| [`icons.js`](icons.js) | Every icon in the app, as inline SVG strings. |
| [`ui.js`](ui.js) | Icon hydration, modal open/close, HTML escaping, all time formatting. |
| [`update.js`](update.js) | Service worker registration plus the update and offline bar. |
| [`api.js`](api.js) | Calls `/api`, falls back to IndexedDB, classifies fresh vs stale. |
| [`store.js`](store.js) | IndexedDB wrapper. Cached payloads, favourites, meta. |
| [`normalise.js`](normalise.js) | The fixture shape, sorting, grouping, status labels. |
| [`favourites.js`](favourites.js) | Starred items, with the signed-in sync interface. |
| [`views.js`](views.js) | All rendering. Normalised fixtures in, markup out. |

Boot order is fixed, and `app.js` documents it:

```js
initTheme();          // before paint work, so nothing flashes
hydrateIcons();
updateThemeButtonIcon();
buildThemeModal();
wireModals();
initUpdateBar();      // registers the worker on load, not now
```

## theme.js

Copied from `uwuapps-theme.md` at the repo root. **Change `APP_KEY` only.**
If the canonical version in the spec changes, re-copy it rather than
patching this one by hand.

Two things that look like one:

| | What it is | Values |
|---|---|---|
| Preference | What the person chose | `light`, `dark`, `time` |
| Mode | What the document is in | `light`, `dark` |

`data-mode` is never anything but `light` or `dark`. `localStorage` stores
the **preference**, so picking Time-based and reloading in the evening still
shows Time-based pressed, not Dark.

The daylight window, 09:00 up to but not including 18:00, is duplicated in
the pre-paint script in every `<head>`. It has to be: that script runs
before first paint and cannot import anything. **Change both together.**
Three files have a copy: `index.html`, `offline.html` and `404.html`.

A tab left open across a boundary re-resolves itself through one scheduled
timer, not polling, plus a `visibilitychange` check for a device that slept
through it. When the mode does change, `uwu:modechange` fires on `document`.

## update.js

Follows `update-bar-spec.md` exactly. The rule it rests on: **a new worker
never activates on its own.** It downloads, installs, and waits. Only a
person pressing Reload promotes it.

Three things here are easy to get wrong and are all real failures:

- The reload happens on `controllerchange`, never in the click handler.
  Reloading immediately races the worker, the page comes back on the *old*
  one, and the prompt reappears. That looks like a button that does nothing.
- A worker already waiting when the page opened is handled separately from
  `updatefound`. Most readers meet an update on their *next* visit, and a
  build that only listens for `updatefound` shows the prompt to almost
  nobody while looking fine in testing.
- Dismissal is per page view and never stored. "Not now" means not now.

The offline bar shares this region and outranks the update bar. Two stacked
bars above the header stop being unobtrusive, and not reaching the site at
all matters more than a version being ready.

## Rendering and safety

`views.js` builds markup with template strings, so **everything interpolated
goes through `escapeHtml()` from `ui.js` first.** Team and competition names
come from third party APIs and are not trusted input.

Icons are never emoji. `views.js` emits `data-icon="name"` and calls
`hydrateIcons()` on the container afterwards.

## Time

All of it lives in `ui.js`. Start times render in the reader's own timezone
via `toLocaleString`; the source timezone appears on the detail view only.
`relativeTime()` is coarse on purpose, since a stamp ticking every second
reads as a countdown and the data behind it is not that fresh.
