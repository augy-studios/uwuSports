/* Jolpica-F1: the entire Formula 1 section.

   No API key, no signup, Apache 2.0, and a drop-in replacement for the
   deprecated Ergast API. 200 requests an hour unauthenticated, which is
   generous next to everything else here, but the cache TTLs still apply:
   a race weekend is the one time this gets hit hard.

   Gives schedules, results, qualifying, driver and constructor standings,
   lap times and pit stops. */

import { getJson } from "../http.js";
import { makeFixture, combineDateTime, toNumberOrNull } from "../normalise.js";

const BASE = (process.env.JOLPICA_BASE_URL || "https://api.jolpi.ca/ergast/f1").replace(/\/$/, "");
const SOURCE = "Jolpica-F1";

export const id = "jolpica";
export const sport = "formula1";

function seasonFor(date) {
  return new Date(date || Date.now()).getUTCFullYear();
}

/* A grand prix is not two teams against each other, so the shared shape
   bends a little here: homeName carries the race name and awayName the
   circuit. That keeps one card component for the whole app rather than a
   special case in the UI, which was the point of normalising. */
function raceToFixture(race, status) {
  return makeFixture({
    id: `f1-${race.season}-${race.round}`,
    sport: "formula1",
    competition: `Formula 1 ${race.season}`,
    homeName: race.raceName,
    awayName: race.Circuit?.circuitName || null,
    homeScore: null,
    awayScore: null,
    status,
    startTime: combineDateTime(race.date, race.time),
    venue: [race.Circuit?.Location?.locality, race.Circuit?.Location?.country]
      .filter(Boolean)
      .join(", ") || null,
    source: SOURCE,
    sourceTimezone: "UTC",
  });
}

function statusForRace(race) {
  const start = combineDateTime(race.date, race.time);
  if (!start) return "unknown";

  const startMs = new Date(start).getTime();
  const now = Date.now();

  // A grand prix runs about two hours. Jolpica publishes no live flag, so
  // the window is inferred rather than reported, and it is never labelled
  // as a live score, only as in progress.
  if (now < startMs) return "scheduled";
  if (now < startMs + 2.5 * 60 * 60 * 1000) return "live";
  return "finished";
}

export async function fetchSeason(season = seasonFor()) {
  const data = await getJson(`${BASE}/${season}/races/?format=json`, { source: SOURCE });
  const races = data?.MRData?.RaceTable?.Races || [];
  return races.map((race) => raceToFixture(race, statusForRace(race)));
}

/* Races on a given day. The F1 calendar is sparse, so most days this is
   empty and that is the correct answer, not a failure. */
export async function fetchByDate(date) {
  const season = seasonFor(date);
  const fixtures = await fetchSeason(season);
  const day = String(date).slice(0, 10);

  return fixtures.filter((f) => f.startTime && f.startTime.slice(0, 10) === day);
}

/* The next race plus the one just gone, which is what somebody opening the
   F1 tab on an ordinary Tuesday actually wants to see. */
export async function fetchUpcoming(limit = 5) {
  const fixtures = await fetchSeason();
  const now = Date.now();

  const upcoming = fixtures.filter((f) => new Date(f.startTime).getTime() >= now).slice(0, limit);
  const recent = fixtures
    .filter((f) => new Date(f.startTime).getTime() < now)
    .slice(-2);

  return [...recent, ...upcoming];
}

export async function fetchResults(season, round) {
  const data = await getJson(`${BASE}/${season}/${round}/results/?format=json`, { source: SOURCE });
  const race = data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const fixture = raceToFixture(race, "finished");

  fixture.extra = {
    results: (race.Results || []).map((r) => ({
      position: r.position,
      driver: `${r.Driver?.givenName || ""} ${r.Driver?.familyName || ""}`.trim(),
      constructor: r.Constructor?.name || null,
      time: r.Time?.time || null,
      status: r.status || null,
      points: toNumberOrNull(r.points),
    })),
  };

  return fixture;
}

export async function fetchDriverStandings(season = seasonFor()) {
  const data = await getJson(`${BASE}/${season}/driverstandings/?format=json`, { source: SOURCE });
  const list = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];

  return {
    title: `Drivers, ${season}`,
    columns: ["Pos", "Driver", "Team", "Pts"],
    rows: list.map((row) => [
      row.position,
      `${row.Driver?.givenName || ""} ${row.Driver?.familyName || ""}`.trim(),
      row.Constructors?.[0]?.name || "",
      row.points,
    ]),
  };
}

export async function fetchConstructorStandings(season = seasonFor()) {
  const data = await getJson(`${BASE}/${season}/constructorstandings/?format=json`, { source: SOURCE });
  const list = data?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];

  return {
    title: `Constructors, ${season}`,
    columns: ["Pos", "Team", "Pts"],
    rows: list.map((row) => [row.position, row.Constructor?.name || "", row.points]),
  };
}

export async function searchDrivers(query) {
  const season = seasonFor();
  const data = await getJson(`${BASE}/${season}/drivers/?format=json&limit=100`, { source: SOURCE });
  const drivers = data?.MRData?.DriverTable?.Drivers || [];
  const needle = query.toLowerCase();

  return drivers
    .filter((d) => `${d.givenName} ${d.familyName}`.toLowerCase().includes(needle))
    .map((d) => ({
      kind: "driver",
      sport: "formula1",
      id: d.driverId,
      name: `${d.givenName} ${d.familyName}`,
      subtitle: d.nationality || "Formula 1",
      badge: null,
    }));
}
