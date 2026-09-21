/* uwuSports service worker.

   Two rules govern this file, both from update-bar-spec.md at the repo root:

   1. A new worker never activates on its own. skipWaiting() and
      clients.claim() appear exactly once each, inside the message handler
      below, and nowhere else. Moving either into install or activate turns
      the update bar back into a silent takeover, which is the failure mode
      the bar exists to prevent.

   2. SW_VERSION is the trigger. The browser compares this file byte for
      byte, so an unchanged worker means no update prompt however much else
      in the build has moved. Bump it on every deploy that changes anything
      the worker serves. */

const SW_VERSION = "uwusports-2026-09-22-1";

const SHELL_CACHE = `uwusports-shell-${SW_VERSION}`;
const ICON_CACHE = `uwusports-icons-${SW_VERSION}`;
const FONT_CACHE = `uwusports-fonts-${SW_VERSION}`;
/* The payload cache is deliberately not keyed by SW_VERSION. It holds the
   last successful response per view, which is what an offline reader sees.
   Versioning it would throw away every cached fixture on each deploy and
   send somebody offline to an empty app for no reason. */
const PAYLOAD_CACHE = "uwusports-payloads";

const CURRENT_CACHES = [SHELL_CACHE, ICON_CACHE, FONT_CACHE, PAYLOAD_CACHE];

/* Everything needed to paint any view with no network at all. */
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/404.html",
  "/404.css",
  "/css/theme.css",
  "/css/style.css",
  "/js/theme.js",
  "/js/icons.js",
  "/js/ui.js",
  "/js/update.js",
  "/js/store.js",
  "/js/api.js",
  "/js/normalise.js",
  "/js/favourites.js",
  "/js/views.js",
  "/js/app.js",
  "/manifest.json",
  "/favicon.ico",
  "/USC-192.png",
  "/USC-512.png",
];

/* -- Install: precache the shell, then wait -- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      /* Individually, so one 404 in the list does not fail the whole
         install and leave the reader with no worker at all. */
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch((cause) => {
            console.warn("[sw] could not precache", url, cause);
          })
        )
      )
    )
  );

  /* No skipWaiting() here, on purpose. See the header comment. */
});

/* -- Activate: drop caches from older versions -- */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("uwusports-") && !CURRENT_CACHES.includes(k))
            .map((k) => caches.delete(k))
        )
      )
  );

  /* No clients.claim() here either. The page that is open keeps its current
     worker until somebody presses Reload. */
});

/* -- The one message the worker acts on -- */

self.addEventListener("message", (event) => {
  const type = typeof event.data === "string" ? event.data : event.data?.type;

  // The only place either of these is ever called.
  if (type === "skip-waiting") {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }

  if (type === "sw-version") {
    event.source?.postMessage({ type: "sw-version", version: SW_VERSION });
  }
});

/* -- Fetch: strategy per route -- */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations: network first, falling back to the cached shell, so a
  // reader offline gets the app rather than the browser's error page.
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Our own API: network first, and on failure serve the last good payload
  // marked stale so the UI can say so rather than showing an error.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    event.respondWith(payloadNetworkFirst(request));
    return;
  }

  // Team badges and driver images from upstream: cache first, they are
  // effectively immutable and we want them offline.
  if (isImageRequest(request, url)) {
    event.respondWith(cacheFirst(request, ICON_CACHE));
    return;
  }

  // Google Fonts: cache first, immutable.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Anything else same-origin is a static asset: cache first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

function isImageRequest(request, url) {
  if (request.destination === "image") return true;
  return /\.(png|jpe?g|webp|gif|svg)$/i.test(url.pathname);
}

/* -- Strategies -- */

async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match("/index.html"));
    return cached || caches.match("/offline.html");
  }
}

/* Network first, with the last successful body kept per endpoint. On upstream
   or connection failure the stored copy comes back with x-uwu-stale set, which
   is what drives the stale indicator in the UI. Never an error page. */
async function payloadNetworkFirst(request) {
  const cache = await caches.open(PAYLOAD_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      const copy = response.clone();
      const stamped = new Response(await copy.blob(), {
        status: copy.status,
        statusText: copy.statusText,
        headers: withHeader(copy.headers, "x-uwu-cached-at", new Date().toISOString()),
      });
      cache.put(request, stamped);
    }

    return response;
  } catch {
    const cached = await cache.match(request);

    if (cached) {
      const body = await cached.blob();
      return new Response(body, {
        status: 200,
        statusText: "OK",
        headers: withHeader(cached.headers, "x-uwu-stale", "1"),
      });
    }

    return new Response(
      JSON.stringify({
        ok: false,
        stale: false,
        offline: true,
        error: "You appear to be offline, and nothing has been cached for this view yet.",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json", "x-uwu-offline": "1" },
      }
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

function withHeader(headers, name, value) {
  const next = new Headers(headers);
  next.set(name, value);
  return next;
}
