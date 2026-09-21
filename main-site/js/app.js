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
  renderBrowseTabs,
  renderBrowse,
  loadingState,
  emptyState,
  comingSoonState,
  renderFreshness,
} from "./views.js";
import { BROWSE_FILTERS } from "./normalise.js";

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
  badminton: "badminton",
};

/* Routes whose source publishes a table worth fetching. */
const STANDINGS_ROUTES = new Set(["nba", "f1", "football"]);

function currentRoute() {
  const raw = (window.location.hash || "#today").replace(/^#\/?/, "");
  const [name] = raw.split("?");
  return ROUTES.includes(name) ? name : "today";
}

/* Today is the default route, so "#today" in the address bar is noise: the
   bare origin already means the same thing, which is why currentRoute
   treats an empty hash as today.

   replaceState rather than assigning location.hash, because assigning
   would push a history entry and fire hashchange, reloading the view we
   just drew and leaving a back button that goes nowhere visible. This
   edits the current entry in place and fires nothing.

   Every other route keeps its hash, so those stay linkable and
   bookmarkable. */
function tidyAddressBar() {
  if (currentRoute() !== "today") return;
  if (!window.location.hash) return;

  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/* ---- refresh policy ----

   Every fetch is on demand. Nothing polls, nothing refetches when the tab
   regains focus, and nothing refetches on reconnect. A view is loaded once
   when you navigate to it, and after that only the refresh button in the
   top bar goes back to the network.

   This is a deliberate trade against freshness, and the quotas are why.
   Highlightly allows 100 requests a day and SportsAPI Pro allows 100 a day
   shared across every sport it serves. A one minute poll left open through
   an afternoon would exhaust either one by itself, and then the section it
   was polling shows nothing for the rest of the day.

   So the reader decides when to spend a request. The last-updated stamp
   next to the button says how old what they are looking at is, which is
   what makes that choice an informed one instead of a guess.

   Revisiting a route reuses the payload already in memory, so moving
   between tabs costs nothing. */

let inFlight = null;
let lastResult = null;

/* Payloads already fetched this session, keyed by route. A route in here
   renders from memory; only the refresh button clears it. */
const loaded = new Map();

/* Which browse sub-tab is selected. Kept in memory for the session and not
   in the hash: it is a filter over data already loaded, so changing it
   should not push a history entry somebody then has to press back through. */
let browseFilter = "all";

/* ---- loading ---- */

async function load({ force = false } = {}) {
  const route = currentRoute();
  const main = document.getElementById("view");
  const freshness = document.getElementById("freshness");

  if (!main) return;

  /* The sub-tabs belong to browse alone. Hidden first, so an early return
     below cannot leave them stranded above another section. */
  const browseTabs = document.getElementById("browseTabs");
  if (browseTabs) browseTabs.classList.toggle("hidden", route !== "browse");

  /* Olympics has no free source at all, so it never reaches the network.
     Badminton does now, through SportsAPI Pro. */
  if (route === "olympics") {
    main.innerHTML = comingSoonState(route);
    hydrateIcons(main);
    renderFreshness(freshness, { fetchedAt: null, stale: false });
    return;
  }

  /* Already fetched this session, and this is not a refresh: render from
     memory and spend no request. Moving between tabs is free. */
  if (!force && loaded.has(route)) {
    lastResult = loaded.get(route);
    await paint(route, lastResult, main, freshness, browseTabs);
    return;
  }

  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;

  main.innerHTML = loadingState(route === "today" ? "Loading today's fixtures" : "Loading fixtures");

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

    /* Only a usable payload is remembered. Caching a failure would mean a
       transient outage pinned the view until the reader pressed refresh,
       which is the opposite of what the button is for. */
    if (result.ok) loaded.set(route, result);

    await paint(route, result, main, freshness, browseTabs);
  } catch (cause) {
    if (cause?.name === "AbortError") return;
    main.innerHTML = emptyState("Something went wrong", cause.message || "Try again in a moment.", "warning");
    hydrateIcons(main);
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

/* Draws a result, whether it came from the network a moment ago or from
   memory. Shared so a cached render and a fresh one cannot drift apart. */
async function paint(route, result, main, freshness, browseTabs) {
  if (!result.ok) {
    main.innerHTML = emptyState(
      "Nothing to show yet",
      result.error || "uwuSports could not reach any source for this view.",
      "cloudOff"
    );
    hydrateIcons(main);
    renderFreshness(freshness, { fetchedAt: null, stale: false });
    return;
  }

  const favourites = await loadFavourites();

  const fixtures = Array.isArray(result.data?.fixtures) ? result.data.fixtures : [];
  const visible = route === "favourites"
    ? fixtures.filter((f) => favourites.some((fav) => fav.name === f.homeName || fav.name === f.awayName || fav.name === f.competition))
    : fixtures;

  /* A section whose key is unset answers with a reason instead of fixtures.
     Saying so beats an empty list that looks like a quiet day. */
  if (result.data?.available === false) {
    main.innerHTML = emptyState("Not available yet", result.data.reason || "This section is not configured.", "info");
    hydrateIcons(main);
    renderFreshness(freshness, { fetchedAt: result.fetchedAt, stale: result.stale });
    return;
  }

  if (route === "favourites" && !favourites.length) {
    main.innerHTML = emptyState(
      "No favourites yet",
      "Star a team, a driver or a competition anywhere in uwuSports and it will be pinned here and at the top of today.",
      "star"
    );
    hydrateIcons(main);
  } else if (route === "browse") {
    /* Tabs are drawn from the full set, so every count reflects the day
       and not the current filter. */
    renderBrowseTabs(browseTabs, visible, browseFilter);
    renderBrowse(main, visible, favourites, browseFilter);
  } else {
    renderDashboard(main, visible, favourites);
  }

  renderFreshness(freshness, { fetchedAt: result.fetchedAt, stale: result.stale });

  /* Cleared first, so a table from the route we just left does not sit
     under the fixtures of the one we arrived at. */
  const standings = document.getElementById("standings");
  if (standings) standings.innerHTML = "";

  /* Only the sports whose source publishes a table. Badminton is a knockout
     draw with no league table, and browse spans too many competitions for
     one, so asking would spend a request on a certain 404. */
  if (STANDINGS_ROUTES.has(route)) void loadStandings(SPORT_FOR_ROUTE[route]);
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
    tidyAddressBar();
    void load();
  });

  /* Clicking Today or the logo while the address bar is already bare sets
     the hash to the value it effectively has, so no hashchange fires and
     nothing would happen. Handled here so those two always return to the
     dashboard, and so the bare URL is preserved instead of briefly
     gaining a "#today" that tidyAddressBar then removes. */
  document.querySelectorAll('a[href="#today"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      if (window.location.hash) return;
      e.preventDefault();
      if (currentRoute() !== "today") return;
      syncNavState();
      void load();
    });
  });

  /* The only thing in the app that goes back to the network on purpose.
     force skips the session cache; everything else renders what is already
     in memory. */
  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    if (isOffline()) return;
    void load({ force: true });
  });

  /* No visibilitychange refetch and no reconnect refetch, on purpose. Both
     spend a request the reader did not ask for, and at 100 a day that is
     the difference between a working section and an exhausted quota. The
     last-updated stamp tells them how old this is; the button is theirs. */

  /* Starring something changes which fixtures are pinned, not which
     fixtures exist, so this repaints from memory and never refetches. */
  document.addEventListener("uwu:favouriteschange", () => {
    const route = currentRoute();
    if (!lastResult?.ok) return;
    void paint(
      route,
      lastResult,
      document.getElementById("view"),
      document.getElementById("freshness"),
      document.getElementById("browseTabs")
    );
  });

  /* Switching sub-tab is a filter over fixtures already in hand, so it
     redraws from lastResult and never refetches. Spending a request to
     re-filter data we already have would be the wrong trade at these rate
     limits, and it would flash a loading state for nothing. */
  document.getElementById("browseTabs")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-browse-filter]");
    if (!btn) return;

    const next = btn.dataset.browseFilter;
    if (!BROWSE_FILTERS.includes(next) || next === browseFilter) return;

    browseFilter = next;

    const fixtures = Array.isArray(lastResult?.data?.fixtures) ? lastResult.data.fixtures : [];
    const favourites = await loadFavourites();

    renderBrowseTabs(document.getElementById("browseTabs"), fixtures, browseFilter);
    renderBrowse(document.getElementById("view"), fixtures, favourites, browseFilter);
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
  /* After syncNavState, so the Today tab is marked active from the real
     route before the hash is dropped from the address bar. */
  tidyAddressBar();

  initUpdateBar();

  await detectSession();
  await load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  void boot();
}
