/* Rendering. Every view takes normalised fixtures and knows nothing about
   which adapter produced them. */

import { escapeHtml, localTime, localDate, localDateTime, localTimezoneName, relativeTime, hydrateIcons } from "./ui.js";
import { sortFixtures, groupBySport, statusLabel, sportLabel, sportIcon, hasScore } from "./normalise.js";
import { fixtureIsFavourited } from "./favourites.js";

/* ---- fixture card ---- */

export function fixtureCard(fixture, { starred = false } = {}) {
  const live = fixture.status === "live";
  const score = hasScore(fixture);

  return `
    <article class="fixture glass" data-fixture-id="${escapeHtml(fixture.id)}" data-sport="${escapeHtml(fixture.sport)}" tabindex="0" role="button" aria-label="${escapeHtml(`${fixture.homeName} against ${fixture.awayName}`)}">
      <header class="fixture-head">
        <span class="fixture-comp">${escapeHtml(fixture.competition || sportLabel(fixture.sport))}</span>
        ${statusBadge(fixture)}
      </header>

      <div class="fixture-body">
        <div class="fixture-side">
          ${badge(fixture.homeBadge, fixture.homeName)}
          <span class="fixture-name">${escapeHtml(fixture.homeName || "To be confirmed")}</span>
          <span class="fixture-score${score ? "" : " is-empty"}">${score ? escapeHtml(fixture.homeScore) : ""}</span>
        </div>
        <div class="fixture-side">
          ${badge(fixture.awayBadge, fixture.awayName)}
          <span class="fixture-name">${escapeHtml(fixture.awayName || "To be confirmed")}</span>
          <span class="fixture-score${score ? "" : " is-empty"}">${score ? escapeHtml(fixture.awayScore) : ""}</span>
        </div>
      </div>

      <footer class="fixture-foot">
        <span class="fixture-time">${escapeHtml(fixture.status === "scheduled" ? `${localDate(fixture.startTime)}, ${localTime(fixture.startTime)}` : localDate(fixture.startTime))}</span>
        ${fixture.venue ? `<span class="fixture-venue">${escapeHtml(fixture.venue)}</span>` : ""}
        ${starred ? `<span class="fixture-star" data-icon="starFilled" aria-label="Favourite"></span>` : ""}
      </footer>
      ${live && fixture.delayed ? `<p class="fixture-note">Scores on this source are delayed, not live.</p>` : ""}
    </article>
  `;
}

function badge(src, name) {
  if (!src) {
    return `<span class="fixture-badge fixture-badge-empty" aria-hidden="true">${escapeHtml((name || "?").slice(0, 1))}</span>`;
  }
  return `<img class="fixture-badge" src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" />`;
}

function statusBadge(fixture) {
  const cls = {
    live: "is-live",
    finished: "is-done",
    scheduled: "is-soon",
    postponed: "is-warn",
    cancelled: "is-warn",
    unknown: "is-warn",
  }[fixture.status] || "is-warn";

  const dot = fixture.status === "live" ? `<span class="status-dot" data-icon="live"></span>` : "";

  return `<span class="fixture-status ${cls}">${dot}${escapeHtml(statusLabel(fixture))}</span>`;
}

/* ---- grouped dashboard ---- */

export function renderDashboard(container, fixtures, favourites) {
  const pinned = fixtures.filter((f) => fixtureIsFavourited(f, favourites));
  const rest = fixtures.filter((f) => !fixtureIsFavourited(f, favourites));

  let html = "";

  if (pinned.length) {
    html += section("Your favourites", "star", sortFixtures(pinned), favourites);
  }

  const groups = groupBySport(rest);

  if (!groups.size && !pinned.length) {
    container.innerHTML = emptyState(
      "Nothing scheduled today",
      "No fixtures came back for today across the sports uwuSports can reach. Try another date, or check back later."
    );
    hydrateIcons(container);
    return;
  }

  for (const [sport, list] of groups) {
    html += section(sportLabel(sport), sportIcon(sport), list, favourites);
  }

  container.innerHTML = html;
  hydrateIcons(container);
}

function section(title, iconName, fixtures, favourites) {
  return `
    <section class="sport-section">
      <h2 class="sport-heading">
        <span class="sport-icon" data-icon="${escapeHtml(iconName)}" aria-hidden="true"></span>
        ${escapeHtml(title)}
        <span class="sport-count">${fixtures.length}</span>
      </h2>
      <div class="fixture-list">
        ${fixtures.map((f) => fixtureCard(f, { starred: fixtureIsFavourited(f, favourites) })).join("")}
      </div>
    </section>
  `;
}

/* ---- detail ---- */

export function renderFixtureDetail(container, fixture) {
  const extras = fixture.extra ? renderExtras(fixture) : "";

  container.innerHTML = `
    <article class="detail glass">
      <p class="detail-comp">${escapeHtml(fixture.competition || sportLabel(fixture.sport))}</p>
      <h2 class="detail-title">${escapeHtml(fixture.homeName)} against ${escapeHtml(fixture.awayName)}</h2>
      ${statusBadge(fixture)}

      ${hasScore(fixture) ? `
        <div class="detail-score">
          <span>${escapeHtml(fixture.homeScore)}</span>
          <span class="detail-score-sep">to</span>
          <span>${escapeHtml(fixture.awayScore)}</span>
        </div>` : ""}

      <dl class="detail-meta">
        <div><dt>Starts</dt><dd>${escapeHtml(localDateTime(fixture.startTime) || "To be confirmed")}</dd></div>
        <div><dt>Your timezone</dt><dd>${escapeHtml(localTimezoneName())}</dd></div>
        ${fixture.sourceTimezone ? `<div><dt>Source timezone</dt><dd>${escapeHtml(fixture.sourceTimezone)}</dd></div>` : ""}
        ${fixture.venue ? `<div><dt>Venue</dt><dd>${escapeHtml(fixture.venue)}</dd></div>` : ""}
        ${fixture.source ? `<div><dt>Data from</dt><dd>${escapeHtml(fixture.source)}</dd></div>` : ""}
      </dl>

      ${fixture.delayed ? `<p class="detail-note"><span data-icon="info" aria-hidden="true"></span> Scores from this source are delayed rather than live.</p>` : ""}
      ${extras}
    </article>
  `;

  hydrateIcons(container);
}

function renderExtras(fixture) {
  const extra = fixture.extra;

  if (fixture.sport === "formula1" && Array.isArray(extra.results)) {
    return `
      <h3 class="detail-subhead">Race results</h3>
      <ol class="result-list">
        ${extra.results.map((r) => `
          <li class="result-row">
            <span class="result-pos">${escapeHtml(r.position)}</span>
            <span class="result-name">${escapeHtml(r.driver)}</span>
            <span class="result-team">${escapeHtml(r.constructor || "")}</span>
            <span class="result-time">${escapeHtml(r.time || r.status || "")}</span>
          </li>`).join("")}
      </ol>`;
  }

  if (fixture.sport === "basketball" && Array.isArray(extra.boxScore)) {
    return `
      <h3 class="detail-subhead">Box score</h3>
      <div class="box-score">
        ${extra.boxScore.map((row) => `
          <div class="box-row">
            <span class="box-team">${escapeHtml(row.team)}</span>
            ${row.periods.map((p) => `<span class="box-period">${escapeHtml(p)}</span>`).join("")}
            <span class="box-total">${escapeHtml(row.total)}</span>
          </div>`).join("")}
      </div>`;
  }

  return "";
}

/* ---- standings ---- */

export function renderStandings(container, standings) {
  if (!standings?.rows?.length) {
    container.innerHTML = emptyState(
      "No table available",
      "The source for this competition does not publish a table that uwuSports can read."
    );
    hydrateIcons(container);
    return;
  }

  container.innerHTML = `
    <div class="table-wrap glass">
      <h3 class="detail-subhead">${escapeHtml(standings.title || "Standings")}</h3>
      <table class="standings">
        <thead>
          <tr>${standings.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${standings.rows.map((row) => `
            <tr>${row.map((cell, i) => i === 0
              ? `<th scope="row">${escapeHtml(cell)}</th>`
              : `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  hydrateIcons(container);
}

/* ---- shared states ---- */

export function emptyState(title, body, iconName = "info") {
  return `
    <div class="state glass">
      <span class="state-icon" data-icon="${escapeHtml(iconName)}" aria-hidden="true"></span>
      <h2 class="state-title">${escapeHtml(title)}</h2>
      <p class="state-body">${escapeHtml(body)}</p>
    </div>
  `;
}

export function loadingState(label = "Loading fixtures") {
  return `
    <div class="state glass" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p class="state-body">${escapeHtml(label)}</p>
    </div>
  `;
}

/* The two coverage gaps. Stated plainly rather than hidden, and no
   placeholder fixtures are ever shipped for either. */
export function comingSoonState(sport) {
  const copy = {
    badminton: {
      title: "Badminton is not available yet",
      body: "No free badminton data source currently exists. The BWF publishes no public API, and the community projects that used to fill the gap have been blocked. uwuSports will add badminton the day a free source appears.",
    },
    olympics: {
      title: "Olympics is not available yet",
      body: "Every Olympic data provider gates its feed behind a paid plan or a sales conversation. uwuSports only uses sources that are free forever, so this section is waiting on one.",
    },
  }[sport];

  if (!copy) return emptyState("Not available", "This section is not ready yet.");

  return `
    <div class="state glass">
      <span class="state-icon" data-icon="info" aria-hidden="true"></span>
      <h2 class="state-title">${escapeHtml(copy.title)}</h2>
      <p class="state-body">${escapeHtml(copy.body)}</p>
    </div>
  `;
}

/* ---- freshness ---- */

export function renderFreshness(node, { fetchedAt, stale }) {
  if (!node) return;

  node.classList.toggle("is-stale", Boolean(stale));
  node.innerHTML = stale
    ? `<span data-icon="cloudOff" aria-hidden="true"></span> Showing saved data from ${escapeHtml(relativeTime(fetchedAt))}`
    : `Updated ${escapeHtml(relativeTime(fetchedAt))}`;

  hydrateIcons(node);
}
