/* The update prompt bar. Canonical source: update-bar-spec.md at the repo
   root. One module, registering the worker once for the whole site.

   The rule the whole design rests on: a new worker never activates on its
   own. It downloads, it installs, and then it waits. The only thing that
   promotes it is a person pressing Reload. Never auto-reload, on a timer or
   otherwise; the reader may be halfway through something. */

import { escapeHtml } from "./ui.js";

const SW_URL = "/sw.js";

const COPY = {
  label: "Update",
  ready: "A new version of uwuSports is ready.",
  reload: "Reload",
  later: "Not now",
};

let registration = null;
let waitingWorker = null;
let reloading = false;
let dismissed = false;

/* The offline bar shares this region. Only the most urgent notice draws:
   being unable to reach the site at all outranks a version being ready.
   Two stacked bars above the header stop being unobtrusive. */
let offline = !navigator.onLine;

const OFFLINE_COPY = {
  label: "Connection",
  text: "You are offline. Showing the last data uwuSports saved.",
};

function watchForUpdate() {
  if (!registration) return;

  /* A worker already waiting when the page opened. This is the ordinary
     case on the second page view after a deploy, and without it the prompt
     would only ever reach somebody who happened to have the page open at
     the moment the new worker finished installing. */
  if (registration.waiting && navigator.serviceWorker.controller) {
    waitingWorker = registration.waiting;
    render();
  }

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener("statechange", () => {
      /* `installed` with a controller present means an update. `installed`
         with no controller is a first install, which has nothing to prompt
         about: there is no previous version on screen to protect. */
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        waitingWorker = registration.waiting ?? installing;
        render();
      }
    });
  });
}

function registerWorker() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker
    .register(SW_URL)
    .then((reg) => {
      registration = reg;
      watchForUpdate();
    })
    .catch((cause) => {
      /* A refused registration is not a reason to break the page. Private
         browsing in some browsers, and any http origin that is not
         localhost, land here. */
      console.warn("service worker registration failed:", cause);
    });

  /* The swap, once somebody has accepted it. Reloading here rather than in
     the click handler is what makes the page come back on the new version:
     the controller has changed by this point, so the reload is served by
     the new worker and not the one being replaced. */
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

function render() {
  const existing = document.querySelector(".update-notice");

  /* Precedence: offline first, then a waiting update, then nothing. */
  const state = offline ? "offline" : waitingWorker && !dismissed ? "update" : null;

  if (!state) {
    existing?.remove();
    return;
  }

  const bar = existing ?? document.createElement("div");
  bar.className = `update-notice update-notice-${state}`;
  /* role="status", not role="alert". Nothing is wrong. An alert interrupts
     a screen reader mid-sentence to say a website is slightly newer. */
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-label", state === "offline" ? OFFLINE_COPY.label : COPY.label);

  if (state === "offline") {
    bar.innerHTML = `
      <div class="update-notice-inner">
        <span class="update-notice-icon" aria-hidden="true"></span>
        <p>${escapeHtml(OFFLINE_COPY.text)}</p>
      </div>
    `;
    bar.querySelector(".update-notice-icon").innerHTML = cloudOffIcon();
  } else {
    bar.innerHTML = `
      <div class="update-notice-inner">
        <p>${escapeHtml(COPY.ready)}</p>
        <button type="button" class="notice-btn notice-btn-primary" data-sw-update>
          ${escapeHtml(COPY.reload)}
        </button>
        <button type="button" class="notice-btn notice-btn-quiet" data-sw-later>
          ${escapeHtml(COPY.later)}
        </button>
      </div>
    `;

    bar.querySelector("[data-sw-update]").addEventListener("click", () => {
      /* The only place anything asks for skipWaiting. The reload happens on
         controllerchange, not here: reloading immediately would race the
         worker and the prompt would reappear on the fresh page. */
      waitingWorker?.postMessage("skip-waiting");
    });

    bar.querySelector("[data-sw-later]").addEventListener("click", () => {
      /* Dismissal is for this page view only, and is never stored. "Not
         now" means not now. Persisting it means a reader who dismisses once
         never hears about an update again. */
      dismissed = true;
      render();
    });
  }

  if (!existing) document.body.prepend(bar);
}

/* Inlined rather than imported from icons.js so the bar can draw before the
   rest of the app has hydrated, including on the offline page. */
function cloudOffIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M8.3 8.3A4.5 4.5 0 0 0 7 17h9.2"/><path d="M11.4 5.2A5.5 5.5 0 0 1 20 10a4 4 0 0 1 .9 7.5"/></svg>`;
}

function watchConnection() {
  const sync = () => {
    const next = !navigator.onLine;
    if (next === offline) return;
    offline = next;
    document.documentElement.classList.toggle("is-offline", offline);
    document.dispatchEvent(new CustomEvent("uwu:connectionchange", { detail: { offline } }));
    render();
  };

  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  document.documentElement.classList.toggle("is-offline", offline);
}

export function isOffline() {
  return offline;
}

export function initUpdateBar() {
  watchConnection();
  if (offline) render();

  /* Registration on `load`, not immediately: installing fetches everything
     the worker precaches, and starting that while the page is still
     fetching its own assets is how a service worker makes a first visit
     slower for no gain. */
  if (document.readyState === "complete") registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
}
