/* GET  /api/favourites          the signed-in reader's starred items
   POST /api/favourites          { action: "add" | "remove", favourite }

   Favourites live in uwu_user_data, the shared suite table, keyed by the
   uwuSports namespace. That is deliberate: a favourite is user data that
   belongs to the person across the suite, not to this app. Tables that
   uwuSports owns on its own carry the uwusports_ prefix instead, which is
   why the cache table is uwusports_api_cache and this one is not.

   Signed out, the client never calls this: everything is in IndexedDB and
   never leaves the device. This endpoint exists so that adding the
   uwu_users login flow later needs no change on the client side.

   Until that flow ships, sessionFor() returns null and every call here
   answers 401. It does not guess at a session format. */

import { supabase, hasSupabase } from "./_lib/supabase.js";
import { ok, fail, json, methodGuard } from "./_lib/respond.js";

const TABLE = "uwu_user_data";
const NAMESPACE = "uwusports.favourites";

export default async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;

  if (!hasSupabase()) {
    return fail(res, 503, "Favourites sync is not configured on this deployment.");
  }

  const session = await sessionFor(req);

  if (!session) {
    /* Not an error the reader should ever see: the client only calls this
       when it believes it is signed in. */
    return fail(res, 401, "Sign in to sync favourites across devices.");
  }

  if (req.method === "GET") return readFavourites(res, session);
  return writeFavourite(req, res, session);
}

/* Resolve the uwu_sessions cookie to a user id.

   Deliberately unimplemented. uwuSports has no login UI yet, and writing a
   lookup against a column layout I have not verified would either fail
   silently or, worse, match the wrong row. When the login flow is added,
   this is the only function that needs filling in. */
async function sessionFor(req) {
  const cookie = req.headers?.cookie || "";
  const token = /uwu_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) return null;

  // TODO: look the token up in uwu_sessions and return { userId }, once the
  // shared schema for that table is confirmed.
  return null;
}

async function readFavourites(res, session) {
  const { data, error } = await supabase()
    .from(TABLE)
    .select("value")
    .eq("user_id", session.userId)
    .eq("namespace", NAMESPACE)
    .maybeSingle();

  if (error) return fail(res, 502, "Favourites could not be read.");

  const list = Array.isArray(data?.value) ? data.value : [];
  return json(res, 200, { ok: true, data: list, stale: false, fetchedAt: new Date().toISOString() });
}

async function writeFavourite(req, res, session) {
  const body = await readBody(req);

  if (!body?.action || !body?.favourite) {
    return fail(res, 400, "An action and a favourite are both required.");
  }

  const { data } = await supabase()
    .from(TABLE)
    .select("value")
    .eq("user_id", session.userId)
    .eq("namespace", NAMESPACE)
    .maybeSingle();

  const current = Array.isArray(data?.value) ? data.value : [];
  let next;

  if (body.action === "add") {
    next = [...current.filter((f) => f.key !== body.favourite.key), body.favourite];
  } else if (body.action === "remove") {
    next = current.filter((f) => f.key !== body.favourite.key);
  } else {
    return fail(res, 400, `Unknown action: ${body.action}`);
  }

  const { error } = await supabase()
    .from(TABLE)
    .upsert(
      {
        user_id: session.userId,
        namespace: NAMESPACE,
        value: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,namespace" }
    );

  if (error) return fail(res, 502, "That favourite could not be saved.");

  return json(res, 200, { ok: true, data: next, stale: false, fetchedAt: new Date().toISOString() });
}

async function readBody(req) {
  if (req.body) return typeof req.body === "string" ? safeParse(req.body) : req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return safeParse(Buffer.concat(chunks).toString("utf8"));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
