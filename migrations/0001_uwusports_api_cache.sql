-- 0001_uwusports_api_cache
--
-- The shared upstream response cache.
--
-- Vercel functions do not share memory between invocations, so a per
-- instance Map would let a cold start go straight to an upstream that
-- allows 100 requests a day. This table is the durable layer behind the
-- in-memory one in main-site/api/_lib/cache.js.
--
-- Safe to run more than once.

create table if not exists public.uwusports_api_cache (
  cache_key  text        primary key,
  payload    jsonb       not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.uwusports_api_cache is
  'Cached third party sports API responses, keyed by endpoint and query. Written only by the uwuSports serverless functions.';

comment on column public.uwusports_api_cache.cache_key is
  'Endpoint and query, lowercased and colon separated. Built by cacheKey() in api/_lib/cache.js.';

comment on column public.uwusports_api_cache.fetched_at is
  'When the upstream actually answered. Surfaced to the reader as the last updated stamp.';

comment on column public.uwusports_api_cache.expires_at is
  'When this stops being fresh. An expired row is still served, marked stale, if the upstream is failing.';

-- Sweeping old rows is a range scan over expires_at, and nothing else
-- queries by it, so this one index covers the only non primary key access
-- pattern the app has.
create index if not exists uwusports_api_cache_expires_at_idx
  on public.uwusports_api_cache (expires_at);

-- Row level security on, with no policy, on purpose.
--
-- Only the service role key touches this table, and that key bypasses RLS
-- entirely. Leaving RLS enabled with no policy means a leaked anon key
-- reaches nothing here, and not every cached payload.
alter table public.uwusports_api_cache enable row level security;
