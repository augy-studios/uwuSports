# migrations

SQL for the shared uwuapps Supabase project. Plain `.sql` files, numbered,
applied in order.

This directory sits at the repo root rather than inside `main-site/`, and
that is deliberate: Vercel's root directory is `main-site`, so anything in
there is uploaded on every deploy and, unless excluded, served at a public
URL. Schema definitions have no business being fetchable over HTTP.

| File | What it does | Run it? |
|---|---|---|
| [`0001_uwusports_api_cache.sql`](0001_uwusports_api_cache.sql) | Creates the upstream response cache table | Yes |
| [`0002_uwusports_cache_cleanup.sql`](0002_uwusports_cache_cleanup.sql) | Adds a prune function for expired rows | Yes |
| [`0003_shared_suite_tables.reference.sql`](0003_shared_suite_tables.reference.sql) | Documents the shared `uwu_user_data` shape | **No** |

`0003` is reference only. Every statement in it is commented out, and the
file explains why: those tables belong to the suite, not to this app.

## Applying them

Nothing here needs a migration tool. Open the Supabase SQL editor, paste
each runnable file in numeric order, and run it.

Every runnable file is **idempotent**: `create table if not exists`,
`create index if not exists`, `create or replace function`. Running one
twice is a no-op, so re-applying the whole directory to an existing project
is safe.

If you would rather use the CLI:

```bash
psql "$SUPABASE_DB_URL" -f migrations/0001_uwusports_api_cache.sql
psql "$SUPABASE_DB_URL" -f migrations/0002_uwusports_cache_cleanup.sql
```

The connection string is under Project settings, Database, in the Supabase
dashboard. It is not one of the variables in `.env.example`, because the app
never connects to Postgres directly: it goes through PostgREST with the
service role key.

## What the app needs

**Only `0001`.** That one table is the shared cache, and without it the
serverless functions fall back to per instance in-memory caching and log a
warning. The site still works; it just hits the upstreams harder, which
matters most for API-Sports at 100 requests a day.

`0002` is housekeeping. Expired rows never affect correctness, since every
read checks `expires_at`. They are a storage cost, nothing more.

Favourites need no migration at all while signed out. They live in
IndexedDB and never leave the device.

## Adding one

1. Number it next in sequence, with a short description:
   `0004_whatever_it_does.sql`.
2. Make it idempotent. Assume it will be run against a database that has
   already seen it.
3. Prefix any table this app owns with `uwusports_`. Tables shared across
   the suite keep their `uwu_` names and do not belong in a runnable file
   here.
4. Say in a comment what happens if it is *not* applied. Every migration in
   this directory is optional in some sense, and the next person needs to
   know which ones actually matter.
5. Enable row level security on any new table. The service role key bypasses
   it, so RLS with no policy is the right default: a leaked anon key then
   reaches nothing.

## Constants that are duplicated

The seven day window in `0002` matches `STALE_GRACE_SECONDS` in
[`../main-site/api/_lib/cache.js`](../main-site/api/_lib/cache.js). Past it,
a row can no longer be served even as stale, so it is dead weight. **Change
both together.**
