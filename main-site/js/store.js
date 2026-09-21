/* IndexedDB. Two jobs:

   1. The last successful payload per view, so an offline reader sees the
      last known data with a stale indicator rather than an error page. The
      service worker also caches API responses, but this copy is what
      survives a cache eviction and what carries the fetched-at stamp the
      UI shows.

   2. Favourites, when nobody is signed in. See favourites.js for the
      signed-in branch. */

const DB_NAME = "uwusports";
const DB_VERSION = 1;

const STORE_PAYLOADS = "payloads";
const STORE_FAVOURITES = "favourites";
const STORE_META = "meta";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PAYLOADS)) {
        db.createObjectStore(STORE_PAYLOADS, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_FAVOURITES)) {
        db.createObjectStore(STORE_FAVOURITES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/* Every call is wrapped: private browsing, a blocked upgrade, or a full
   disk must degrade to a working online-only app, never to a broken one. */
async function withStore(name, mode, fn) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      const result = fn(store);

      tx.oncomplete = () => resolve(result?.result ?? result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (cause) {
    console.warn("[store] unavailable:", cause);
    return null;
  }
}

/* ---- payload cache ---- */

export async function savePayload(key, data) {
  return withStore(STORE_PAYLOADS, "readwrite", (store) =>
    store.put({ key, data, fetchedAt: new Date().toISOString() })
  );
}

export async function readPayload(key) {
  const record = await withStore(STORE_PAYLOADS, "readonly", (store) => store.get(key));
  if (!record) return null;
  return { data: record.data, fetchedAt: record.fetchedAt };
}

export async function clearPayloads() {
  return withStore(STORE_PAYLOADS, "readwrite", (store) => store.clear());
}

/* ---- favourites ---- */

export async function readFavourites() {
  const records = await withStore(STORE_FAVOURITES, "readonly", (store) => store.getAll());
  return Array.isArray(records) ? records : [];
}

export async function putFavourite(favourite) {
  return withStore(STORE_FAVOURITES, "readwrite", (store) => store.put(favourite));
}

export async function deleteFavourite(key) {
  return withStore(STORE_FAVOURITES, "readwrite", (store) => store.delete(key));
}

export async function replaceFavourites(list) {
  return withStore(STORE_FAVOURITES, "readwrite", (store) => {
    store.clear();
    for (const item of list) store.put(item);
  });
}

/* ---- meta ---- */

export async function readMeta(key) {
  const record = await withStore(STORE_META, "readonly", (store) => store.get(key));
  return record?.value ?? null;
}

export async function writeMeta(key, value) {
  return withStore(STORE_META, "readwrite", (store) => store.put({ key, value }));
}
