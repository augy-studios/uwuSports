/* Favourites: starred teams, drivers and competitions, pinned to the top of
   the dashboard.

   Two backends behind one interface. Signed out, everything lives in
   IndexedDB and never leaves the device. Signed in, the same operations
   also write to uwu_user_data through /api/favourites, which is the shared
   suite table and not anything uwuSports owns.

   The signed-in branch is wired but dormant: uwuSports ships no login UI
   yet, so isSignedIn() is always false until the uwu_users session cookie
   is confirmed against the real schema. The interface is here so adding
   that later touches this file and nothing else. */

import { readFavourites, putFavourite, deleteFavourite, replaceFavourites } from "./store.js";
import { request } from "./api.js";

export const FAVOURITE_KINDS = ["team", "driver", "competition"];

let cache = null;
let signedIn = false;

/* Stable key, so the same team starred from two different views is one
   favourite and not two. */
export function favouriteKey(kind, sport, id) {
  return `${kind}:${sport}:${id}`;
}

export function isSignedIn() {
  return signedIn;
}

/* Called once at boot. Until a uwu_sessions cookie check is added, this
   resolves to signed out and the app runs entirely on IndexedDB. */
export async function detectSession() {
  signedIn = false;
  return signedIn;
}

export async function loadFavourites() {
  if (cache) return cache;

  const local = await readFavourites();
  cache = Array.isArray(local) ? local : [];

  if (signedIn) {
    try {
      const remote = await request("/favourites");
      if (remote.ok && Array.isArray(remote.data)) {
        cache = mergeByKey(cache, remote.data);
        await replaceFavourites(cache);
      }
    } catch (cause) {
      /* A sync failure is not a reason to lose the local list. */
      console.warn("[favourites] sync failed, using local copy:", cause);
    }
  }

  return cache;
}

function mergeByKey(local, remote) {
  const merged = new Map();
  for (const item of local) merged.set(item.key, item);
  for (const item of remote) merged.set(item.key, item);
  return [...merged.values()];
}

export async function isFavourite(kind, sport, id) {
  const list = await loadFavourites();
  return list.some((f) => f.key === favouriteKey(kind, sport, id));
}

export async function addFavourite({ kind, sport, id, name, badge }) {
  if (!FAVOURITE_KINDS.includes(kind)) {
    throw new Error(`Unknown favourite kind: ${kind}`);
  }

  const favourite = {
    key: favouriteKey(kind, sport, id),
    kind,
    sport,
    id: String(id),
    name: name || String(id),
    badge: badge || null,
    addedAt: new Date().toISOString(),
  };

  await putFavourite(favourite);
  cache = mergeByKey(cache || [], [favourite]);

  if (signedIn) void pushRemote("add", favourite);

  notify();
  return favourite;
}

export async function removeFavourite(kind, sport, id) {
  const key = favouriteKey(kind, sport, id);

  await deleteFavourite(key);
  cache = (cache || []).filter((f) => f.key !== key);

  if (signedIn) void pushRemote("remove", { key });

  notify();
}

export async function toggleFavourite(entry) {
  const exists = await isFavourite(entry.kind, entry.sport, entry.id);
  if (exists) {
    await removeFavourite(entry.kind, entry.sport, entry.id);
    return false;
  }
  await addFavourite(entry);
  return true;
}

/* Fire and forget. A failed write leaves the local copy correct and the
   next loadFavourites() merge reconciles it. */
async function pushRemote(action, payload) {
  try {
    await fetch("/api/favourites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, favourite: payload }),
    });
  } catch (cause) {
    console.warn("[favourites] remote write failed:", cause);
  }
}

function notify() {
  document.dispatchEvent(
    new CustomEvent("uwu:favouriteschange", { detail: { favourites: cache || [] } })
  );
}

/* Does this fixture involve anything starred? Drives the pinned block at
   the top of the dashboard. */
export function fixtureIsFavourited(fixture, favourites) {
  if (!favourites?.length) return false;

  return favourites.some((f) => {
    if (f.sport !== fixture.sport) return false;
    if (f.kind === "competition") return f.name === fixture.competition;
    return f.name === fixture.homeName || f.name === fixture.awayName;
  });
}
