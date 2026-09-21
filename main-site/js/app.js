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
import { getToday, getSport, getFixture, getStandings, search as searchApi } from "./api.js";
import { detectSession, loadFavourites, toggleFavourite } from "./favourites.js";
import {
  renderDashboard,
  renderStandings,
  renderBrowseTabs,
  renderBrowse,
  renderFixtureDetail,
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

/* ---- routing ----

   The address bar never shows a route. Navigating uses pushState with the
   route carried in history.state instead of the URL, so the bar stays at
   the bare origin everywhere, not only on today.

   What this costs, stated plainly: a route is no longer linkable or
   bookmarkable, and a reload always lands on today. That is the trade for
   a clean URL, and it is only acceptable here because every route is one
   tap from every other one.

   What it keeps: back and forward still work, because each navigation is
   a real history entry. That is why this is pushState and not a plain
   variable. */

let activeRoute = "today";

/* The fixture whose detail view is open, as { sport, id }, or null for the
   list. Kept alongside the route in history.state so back closes the
   detail view instead of leaving the page. */
let detailFixture = null;

function currentRoute() {
  return ROUTES.includes(activeRoute) ? activeRoute : "today";
}

/* An old-style "#nba" link, from a bookmark or another page, still works:
   it is read once at boot and then removed from the bar. */
function routeFromHash() {
  const raw = (window.location.hash || "").replace(/^#\/?/, "");
  const [name] = raw.split("?");
  return ROUTES.includes(name) ? name : null;
}

function bareUrl() {
  return window.location.pathname + window.location.search;
}

/* Navigate. Pushes a history entry so back returns to the previous route,
   while the visible URL stays bare. */
function goToRoute(route, { replace = false } = {}) {
  if (!ROUTES.includes(route)) route = "today";
  activeRoute = route;

  const state = { route };
  if (replace) history.replaceState(state, "", bareUrl());
  else history.pushState(state, "", bareUrl());
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

/* ---- detail view ---- */

/* Opening a fixture is a history entry, so back closes it and returns to
   the list exactly where it was. */
function openDetail(sport, id) {
  if (!sport || !id) return;

  detailFixture = { sport, id };
  history.pushState({ route: currentRoute(), fixture: detailFixture }, "", bareUrl());
  void load();
}

async function loadDetail({ sport, id }) {
  const main = document.getElementById("view");
  const freshness = document.getElementById("freshness");
  const standings = document.getElementById("standings");
  const browseTabs = document.getElementById("browseTabs");

  if (!main) return;

  /* The detail view is its own thing: no sub-tabs, no league table. */
  if (browseTabs) browseTabs.classList.add("hidden");
  if (standings) standings.innerHTML = "";

  /* Everything the card already showed is in memory, so draw that first
     and let the extras arrive. A spinner here would hide information the
     reader can already see. */
  const known = findLoadedFixture(sport, id);
  if (known) renderFixtureDetail(main, known);
  else main.innerHTML = loadingState("Loading fixture");

  const cacheKey = `detail:${sport}:${id}`;

  if (loaded.has(cacheKey)) {
    const cached = loaded.get(cacheKey);
    renderFixtureDetail(main, cached.data);
    renderFreshness(freshness, { fetchedAt: cached.fetchedAt, stale: cached.stale });
    return;
  }

  const result = await getFixture(sport, id);

  if (result.ok && result.data) {
    loaded.set(cacheKey, result);
    renderFixtureDetail(main, result.data);
    renderFreshness(freshness, { fetchedAt: result.fetchedAt, stale: result.stale });
    return;
  }

  /* No extras available. The card's own data is still worth showing, and
     several sources have no per-fixture endpoint at all on the free tier. */
  if (known) {
    renderFreshness(freshness, { fetchedAt: lastResult?.fetchedAt, stale: lastResult?.stale });
    return;
  }

  main.innerHTML = emptyState(
    "That fixture is not available",
    result.error || "This source does not publish details for a single fixture on its free tier.",
    "info"
  );
  hydrateIcons(main);
}

/* The fixture as the list already knows it, so the detail view can paint
   before any request resolves. */
function findLoadedFixture(sport, id) {
  for (const result of loaded.values()) {
    const fixtures = result?.data?.fixtures;
    if (!Array.isArray(fixtures)) continue;
    const hit = fixtures.find((f) => String(f.id) === String(id));
    if (hit) return hit;
  }
  return null;
}

/* ---- loading ---- */

async function load({ force = false } = {}) {
  const route = currentRoute();
  const main = document.getElementById("view");
  const freshness = document.getElementById("freshness");

  if (!main) return;

  /* A detail view is open on top of the current route. */
  if (detailFixture) {
    await loadDetail(detailFixture);
    return;
  }

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
  /* Back and forward. The route lives in history.state, so a popped entry
     carries its own route; a null state is the entry the page opened on,
     which is today. */
  window.addEventListener("popstate", (e) => {
    activeRoute = ROUTES.includes(e.state?.route) ? e.state.route : "today";
    detailFixture = e.state?.fixture || null;
    syncNavState();
    void load();
  });

  /* Every in-app route link. The href stays a real "#route" so the markup
     degrades without JavaScript and middle click still does something
     sensible, but the click is intercepted so the hash never reaches the
     address bar. */
  document.querySelectorAll("a[data-route]").forEach((link) => {
    link.addEventListener("click", (e) => {
      /* Leave modified clicks to the browser: a new tab has no in-memory
         state and needs the real URL. */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      e.preventDefault();
      const route = link.dataset.route;
      if (route === currentRoute() && !detailFixture) return;

      detailFixture = null;
      goToRoute(route);
      syncNavState();
      void load();
    });
  });

  /* The logo goes home. It carries no data-route, so it is handled here. */
  document.querySelector(".brand")?.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    detailFixture = null;
    goToRoute("today");
    syncNavState();
    void load();
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
    /* Star first: it sits inside the card, so checking it before the open
       control stops a star press also opening the detail view. */
    const star = e.target.closest("[data-fav-toggle]");
    if (star) {
      e.preventDefault();
      e.stopPropagation();
      void toggleFavourite({
        kind: star.dataset.favKind,
        sport: star.dataset.favSport,
        id: star.dataset.favId,
        name: star.dataset.favName,
      });
      return;
    }

    if (e.target.closest("[data-detail-back]")) {
      history.back();
      return;
    }

    const open = e.target.closest("[data-fixture-open]");
    if (!open) return;

    const card = open.closest("[data-fixture-id]");
    if (!card) return;

    openDetail(card.dataset.sport, card.dataset.fixtureId);
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
  /* Honour an incoming "#nba" once, from an old bookmark or an external
     link, then replace that entry so the hash leaves the address bar
     without adding a history step the reader has to press back through. */
  goToRoute(routeFromHash() || "today", { replace: true });

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
