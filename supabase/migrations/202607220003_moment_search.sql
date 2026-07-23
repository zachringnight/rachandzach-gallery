-- 202607220003_moment_search.sql
-- Moment Search: pgvector-backed scene/object search over approved photo
-- previews (packet 07). Separate and reversible from the core catalog
-- schema (202607220001_gallery_core.sql / 202607220002_storage_policies.sql)
-- so it can be applied or rolled back on its own. Cannot be applied to a
-- local stack today (no Docker); this file is static-asserted in
-- tests/search/moment-search.test.ts the same way packet 03 static-asserted
-- 202607220001/002 in tests/database/schema.test.ts.
--
-- Down migration (manual, if this ever needs to be rolled back):
--   drop function if exists public.rachandzach_search_gallery_moments(vector, text, int);
--   drop table if exists public.rachandzach_photo_embeddings;
--   -- Leave `extension vector` installed: it is additive-only and project-global
--   -- (see the note below); dropping it could break another tenant that starts
--   -- using it after this migration lands.
--
-- ===========================================================================
-- SHARED-PROJECT CONVENTION. Same rule as 202607220001_gallery_core.sql: this
-- migration names only objects it owns (the rachandzach_photo_embeddings
-- table, the rachandzach_search_gallery_moments function, and their indexes)
-- plus one project-global, additive-only extension. No schema-wide grant,
-- revoke, "alter default privileges", event trigger, or publication
-- statement appears anywhere below. Every table and function created here
-- gets its own explicit per-object revoke (public, anon, authenticated) and
-- grant (service_role), exactly as 202607220001 does for every object it
-- creates.
--
-- pgvector readiness verified live and read-only against this project
-- (PrizmLounge, Postgres 17.6) in
-- docs/plans/2026-07-22-0719-digital-wedding-home/spikes/cloud-readiness.md
-- item 1: `vector` extension is available at version 0.8.0, not yet
-- installed, HNSW/IVFFlat both supported up to 2,000 dimensions (this table
-- uses 512), and zero tenants on the shared project use pgvector today, so
-- installing it cannot collide with or break anything else on the project.
-- ===========================================================================

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.rachandzach_photo_embeddings (
  photo_id uuid primary key references public.rachandzach_photos (id) on delete cascade,
  -- Model family, e.g. "openai/clip-vit-base-patch32". Kept separate from
  -- model_version (the pinned revision/commit) so a future model swap is a
  -- filterable, auditable column rather than a string to parse.
  model text not null check (char_length(model) between 1 and 120),
  model_version text not null check (char_length(model_version) between 1 and 60),
  -- 512-dim: openai/clip-vit-base-patch32's projection_dim, confirmed in
  -- spikes/clip-model.md. Both sides (Python image encoder, JS text encoder
  -- in src/lib/search/query-embedding.ts) L2-normalize before this is
  -- written or queried, so cosine and inner-product ranking are identical.
  embedding extensions.vector(512) not null,
  generated_at timestamptz not null default now()
);

-- Approved-cadence filtering happens by joining rachandzach_photos in the RPC
-- below (status = 'published'); this index only ever needs to be scanned for
-- rows that already passed that join, so it does not need a partial
-- predicate of its own. HNSW (not IVFFlat): no training/list-count tuning
-- needed as the catalog grows, and query-time recall is more predictable for
-- this collection's likely size (thousands, not millions, of photos).
create index rachandzach_photo_embeddings_hnsw_idx
  on public.rachandzach_photo_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

create index rachandzach_photo_embeddings_model_version_idx
  on public.rachandzach_photo_embeddings (model, model_version);

-- ---------------------------------------------------------------------------
-- Default deny: RLS on, zero policies. The service role (scripts/build-
-- embeddings.py's live path, and the search RPC's SECURITY DEFINER context)
-- is the only writer or reader; packet 04's server layer mediates everything
-- else, exactly like every other table in this schema.
-- ---------------------------------------------------------------------------

alter table public.rachandzach_photo_embeddings enable row level security;

revoke all on table public.rachandzach_photo_embeddings from public, anon, authenticated;
grant all on table public.rachandzach_photo_embeddings to service_role;

-- ---------------------------------------------------------------------------
-- RPC: public.rachandzach_search_gallery_moments
--
-- Cosine-similarity search over embeddings, joined back to rachandzach_photos
-- (and rachandzach_events for the optional event filter) so photo-status
-- isolation is enforced in the SAME place the rest of the catalog enforces
-- it: guests never see pending, hidden, or rejected photos, from any entry
-- point, including this one. The application layer
-- (src/lib/search/moment-search.ts) re-applies this filter again in-process
-- against task 06's GalleryDataSource before ever building a response --
-- defense in depth, same posture as src/lib/gallery/query.ts documents for
-- its own SQL source.
--
-- result_limit is clamped server-side to [1, 40] regardless of what is
-- passed, so a caller cannot force an unbounded scan even if the
-- application-layer validation in moment-search.ts were ever bypassed.
-- ---------------------------------------------------------------------------

create or replace function public.rachandzach_search_gallery_moments(
  query_embedding extensions.vector(512),
  event_filter text,
  result_limit int
)
returns table (photo_id uuid, similarity float8)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select
    e.photo_id,
    1 - (e.embedding <=> rachandzach_search_gallery_moments.query_embedding) as similarity
  from public.rachandzach_photo_embeddings e
  join public.rachandzach_photos p on p.id = e.photo_id
  left join public.rachandzach_events ev on ev.id = p.event_id
  where p.status = 'published'
    and (
      rachandzach_search_gallery_moments.event_filter is null
      or ev.slug = rachandzach_search_gallery_moments.event_filter
    )
  order by e.embedding <=> rachandzach_search_gallery_moments.query_embedding
  limit least(greatest(coalesce(rachandzach_search_gallery_moments.result_limit, 1), 1), 40)
$$;

revoke all on function public.rachandzach_search_gallery_moments(vector, text, int)
  from public, anon, authenticated;
grant execute on function public.rachandzach_search_gallery_moments(vector, text, int)
  to service_role;
