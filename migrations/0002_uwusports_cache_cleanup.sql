-- 0002_uwusports_cache_cleanup
--
-- Keeping the cache table from growing without bound.
--
-- Expired rows are harmless to correctness: every read in
-- api/_lib/cache.js checks expires_at and treats anything past it as
-- stale. They are only a storage cost, so this is housekeeping rather
-- than a fix for a bug.
--
-- The seven day window matches STALE_GRACE_SECONDS in
-- main-site/api/_lib/cache.js. A row past it can no longer be served even
-- as stale, so it is dead weight. Change both together.
--
-- Safe to run more than once.

create or replace function public.uwusports_prune_api_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.uwusports_api_cache
   where expires_at < now() - interval '7 days';

  get diagnostics removed = row_count;
  return removed;
end;
$$;

comment on function public.uwusports_prune_api_cache() is
  'Deletes cache rows too old to serve even as stale. Returns the number removed. Match the interval to STALE_GRACE_SECONDS in api/_lib/cache.js.';

-- Nothing in the app calls this. Run it by hand from the SQL editor:
--
--   select public.uwusports_prune_api_cache();
--
-- Or schedule it, if pg_cron is enabled on the project. It is not enabled
-- by default, which is why this is commented rather than run:
--
--   create extension if not exists pg_cron;
--   select cron.schedule(
--     'uwusports-prune-api-cache',
--     '17 4 * * *',
--     $$select public.uwusports_prune_api_cache();$$
--   );
--
-- Leaving it unscheduled is a reasonable default. At the TTLs this app
-- uses the table stays small, and an unswept cache costs storage rather
-- than correctness.
