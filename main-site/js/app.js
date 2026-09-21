import {
  COLOR_THEMES,
  applyColorTheme,
  applyMode,
  getStoredColorTheme,
  getStoredMode,
  getModePreference,
  initTheme,
} from "./theme.js";
import { hydrateIcons, openModal, closeModal, escapeHtml, todayISODate } from "./ui.js";
import { initUpdateBar, isOffline } from "./update.js";
import { getToday, getSport, getStandings, search as searchApi } from "./api.js";
import { detectSession, loadFavourites, toggleFavourite } from "./favourites.js";
import {
  renderDashboard,
  renderStandings,
  loadingState,
  emptyState,
  comingSoonState,
  renderFreshness,
} from "./views.js";

/* ---- theme modal ---- */

function buildThemeModal() {
  const grid = document.getElementById("swatchGrid");
  if (!grid) return;

  grid.innerHTML = COLOR_THEMES.map(
    (t) => `
      <button class="swatch" data-theme-id="${t.id}" style="--swatch-color:${t.hex}" type="button" aria-label="${t.label}">
        <span class="swatch-dot"></span>
        <span class="swatch-label">${t.label}</span>
      </button>`
  ).join("");

  syncThemeModalState();

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-id]");
    if (!btn) return;
    applyColorTheme(btn.dataset.themeId);
    syncThemeModalState();
  });

  document.getElementById("modeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    applyMode(btn.dataset.mode);
    syncThemeModalState();
  });

  /* A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
     modal so the note and pressed state stay in step with the change. */
  document.addEventListener("uwu:modechange", syncThemeModalState);
}

function syncThemeModalState() {
  const activeTheme = getStoredColorTheme();
  const activePreference = getModePreference();
  const resolvedMode = getStoredMode();

  document.querySelectorAll("#swatchGrid .swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.themeId === activeTheme);
  });
  document.querySelectorAll("#modeToggle .mode-btn").forEach((el) => {
    const isActive = el.dataset.mode === activePreference;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-pressed", String(isActive));
  });

  const note = document.getElementById("modeNote");
  if (note) {
    note.hidden = activePreference !== "time";
    if (activePreference === "time") {
      note.textContent = `Following the clock. Currently ${resolvedMode}.`;
    }
  }

  updateThemeButtonIcon();
}

function updateThemeButtonIcon() {
  const span = document.querySelector("#themeBtn [data-icon]");
  if (!span) return;
  span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
  hydrateIcons(document.getElementById("themeBtn"));
}

function wireModals() {
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal(backdrop.id);
    });
  });
  const themeBtn = document.getElementById("themeBtn");
  if (themeBtn) themeBtn.addEventListener("click", () => openModal("themeModal"));

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach((m) => closeModal(m.id));
  });
}

/* ---- routing ----
   Hash routing, because the app has to work from the cached shell with no
   server round trip when offline. */

const ROUTES = ["today", "nba", "f1", "football", "browse", "badminton", "olympics", "favourites"];

const SPORT_FOR_ROUTE = {
  nba: "basketball",
  f1: "formula1",
  football: "football",
  browse: "multi",
};

function currentRoute() {
  const raw = (window.location.hash || "#today").replace(/^#\/?/, "");
  const [name] = raw.split("?");
  return ROUTES.includes(name) ? name : "today";
}

/* ---- refresh scheduling ----
   Never poll faster than the slowest source's rate limit allows. The server
   caches live fixtures for 45 seconds, so polling the client faster than
   that only burns battery for the same bytes. 60 seconds when something is
   live, nothing at all when nothing is. */

const LIVE_POLL_MS = 60_000;

let pollTimer = null;
let inFlight = null;
let lastResult = null;

function schedulePoll(hasLive) {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  if (!hasLive || isOffline()) return;

  pollTimer = setTimeout(() => {
    pollTimer = null;
    void load({ quiet: true });
  }, LIVE_POLL_MS);
}

/* ---- loading ---- */

async function load({ quiet = false } = {}) {
  const route = currentRoute();
  const main = document.getElementById("view");
  const freshness = document.getElementById("freshness");

  if (!main) return;

  if (route === "badminton" || route === "olympics") {
    main.innerHTML = comingSoonState(route);
    hydrateIcons(main);
    renderFreshness(freshness, { fetchedAt: null, stale: false });
    schedulePoll(false);
    return;
  }

  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;

  if (!quiet) main.innerHTML = loadingState(route === "today" ? "Loading today's fixtures" : "Loading fixtures");

  try {
    const favourites = await loadFavourites();
    let result;

    if (route === "today") {
      result = await getToday({ date: todayISODate() });
    } else if (route === "favourites") {
      result = await getToday({ date: todayISODate() });
    } else {
      result = await getSport(SPORT_FOR_ROUTE[route], { date: todayISODate() });
    }

    if (controller.signal.aborted) return;

    lastResult = result;

    if (!result.ok) {
      main.innerHTML = emptyState(
        "Nothing to show yet",
        result.error || "uwuSports could not reach any source for this view.",
        "cloudOff"
      );
      hydrateIcons(main);
      renderFreshness(freshness, { fetchedAt: null, stale: false });
      schedulePoll(false);
      return;
    }

    const fixtures = Array.isArray(result.data?.fixtures) ? result.data.fixtures : [];
    const visible = route === "favourites"
      ? fixtures.filter((f) => favourites.some((fav) => fav.name === f.homeName || fav.name === f.awayName || fav.name === f.competition))
      : fixtures;

    if (route === "favourites" && !favourites.length) {
      main.innerHTML = emptyState(
        "No favourites yet",
        "Star a team, a driver or a competition anywhere in uwuSports and it will be pinned here and at the top of today.",
        "star"
      );
      hydrateIcons(main);
    } else {
      renderDashboard(main, visible, favourites);
    }

    renderFreshness(freshness, { fetchedAt: result.fetchedAt, stale: result.stale });
    schedulePoll(visible.some((f) => f.status === "live"));

    if (route !== "today" && route !== "favourites") void loadStandings(SPORT_FOR_ROUTE[route]);
  } catch (cause) {
    if (cause?.name === "AbortError") return;
    main.innerHTML = emptyState("Something went wrong", cause.message || "Try again in a moment.", "warning");
    hydrateIcons(main);
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

async function loadStandings(sport) {
  const node = document.getElementById("standings");
  if (!node) return;

  const result = await getStandings(sport);
  if (result.ok) renderStandings(node, result.data);
  else node.innerHTML = "";
}

/* ---- navigation, search, favourites ---- */

function wireNav() {
  window.addEventListener("hashchange", () => {
    syncNavState();
    void load();
  });

  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    void load();
  });

  /* Coming back to a tab that has been open a while is the moment to
     recheck, the same reasoning as the time based mode's visibility hook. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (isOffline()) return;
    void load({ quiet: true });
  });

  document.addEventListener("uwu:connectionchange", () => {
    if (!isOffline()) void load({ quiet: true });
    else schedulePoll(false);
  });

  document.addEventListener("uwu:favouriteschange", () => {
    void load({ quiet: true });
  });

  document.getElementById("view")?.addEventListener("click", (e) => {
    const star = e.target.closest("[data-fav-toggle]");
    if (star) {
      e.stopPropagation();
      void toggleFavourite({
        kind: star.dataset.favKind,
        sport: star.dataset.favSport,
        id: star.dataset.favId,
        name: star.dataset.favName,
      });
    }
  });
}

function syncNavState() {
  const route = currentRoute();
  document.querySelectorAll("[data-route]").forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function wireSearch() {
  const form = document.getElementById("searchForm");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  if (!form || !input || !results) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query.length < 2) return;

    results.innerHTML = loadingState("Searching");
    const result = await searchApi(query);

    if (!result.ok || !result.data?.results?.length) {
      results.innerHTML = emptyState(
        "Nothing found",
        result.error || `No team, driver or competition matched "${query}".`
      );
      hydrateIcons(results);
      return;
    }

    results.innerHTML = result.data.results
      .map(
        (item) => `
        <button class="search-result" type="button"
          data-fav-toggle data-fav-kind="${escapeHtml(item.kind)}"
          data-fav-sport="${escapeHtml(item.sport)}" data-fav-id="${escapeHtml(item.id)}"
          data-fav-name="${escapeHtml(item.name)}">
          ${item.badge ? `<img class="search-badge" src="${escapeHtml(item.badge)}" alt="" loading="lazy" />` : `<span class="search-badge search-badge-empty" aria-hidden="true"></span>`}
          <span class="search-name">${escapeHtml(item.name)}</span>
          <span class="search-meta">${escapeHtml(item.subtitle || "")}</span>
          <span class="search-star" data-icon="star" aria-hidden="true"></span>
        </button>`
      )
      .join("");

    hydrateIcons(results);
  });

  results.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-fav-toggle]");
    if (!btn) return;
    void toggleFavourite({
      kind: btn.dataset.favKind,
      sport: btn.dataset.favSport,
      id: btn.dataset.favId,
      name: btn.dataset.favName,
    });
  });

  document.getElementById("searchBtn")?.addEventListener("click", () => openModal("searchModal"));
}

/* ---- boot ---- */

async function boot() {
  initTheme();
  hydrateIcons();
  updateThemeButtonIcon();
  buildThemeModal();
  wireModals();
  wireNav();
  wireSearch();
  syncNavState();

  initUpdateBar();

  await detectSession();
  await load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  void boot();
}
