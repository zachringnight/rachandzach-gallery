-- 202607220001_gallery_core.sql
-- Core catalog, upload, moderation, audit, and analytics model for the
-- 0719 + co. digital wedding home. Design goals:
--   * Default deny: RLS is enabled on every table and no policies are created
--     here. Guests and the shared guest session never touch tables directly;
--     packet 04's server layer mediates all access via the service role.
--   * image_data_hash is the stable visual identity (32-char hex today from
--     the master manifest, up to 64 to allow future sha256 identities).
--   * file_sha256 is the byte-identity of the current source file. Original
--     downloads must reproduce it byte for byte.
--   * Source objects are content-hash named so they can never be overwritten
--     in place (see also 202607220002_storage_policies.sql).
--
-- ===========================================================================
-- SHARED-PROJECT CONVENTION. READ BEFORE ADDING ANY MIGRATION.
-- This Supabase project (PrizmLounge) hosts roughly 200 tables owned by
-- other live apps. Every statement in every rachandzach migration must name
-- only objects this project owns: rachandzach_ tables and functions,
-- rachandzach- buckets. Never use schema-wide statements: no revoke or grant
-- "on all tables/functions/sequences in schema", no "alter default
-- privileges", no event triggers, no publications. Those reach objects other
-- tenants own.
-- Because default privileges cannot be changed here, Postgres and Supabase
-- defaults re-grant on every NEW object: anon and authenticated on tables,
-- and execute to PUBLIC on functions. So every future rachandzach migration
-- MUST explicitly revoke public, anon, and authenticated on EACH table and
-- EACH function it creates (including execute on functions), and grant only
-- service_role, exactly as the privileges section at the end of this file
-- does for every object created here.
-- ===========================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Deterministic timestamp handling
-- ---------------------------------------------------------------------------

create or replace function public.rachandzach_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- created_at is immutable; updated_at always reflects the write.
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.rachandzach_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null check (char_length(name) between 1 and 120),
  sort_order int not null default 0,
  starts_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rachandzach_people (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  aliases text[] not null default '{}',
  photo_count int not null default 0 check (photo_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rachandzach_upload_batches (
  id uuid primary key default gen_random_uuid(),
  receipt_hash text not null unique check (receipt_hash ~ '^[0-9a-f]{32,64}$'),
  email text check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  display_name text check (display_name is null or char_length(display_name) between 1 and 120),
  note text check (note is null or char_length(note) <= 2000),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'approved', 'partially_approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rachandzach_photos (
  id uuid primary key default gen_random_uuid(),
  image_data_hash text not null unique
    check (image_data_hash ~ '^[0-9a-f]{32,64}$'),
  file_sha256 text not null
    check (file_sha256 ~ '^[0-9a-f]{64}$'),
  event_id uuid references public.rachandzach_events (id) on delete restrict,
  original_bucket text not null default 'rachandzach-originals'
    check (original_bucket in ('rachandzach-originals', 'rachandzach-guest-approved')),
  original_object text not null,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  original_bytes bigint not null check (original_bytes > 0),
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  captured_at timestamptz,
  source text not null check (source in ('master', 'guest')),
  status text not null default 'published'
    check (status in ('published', 'hidden', 'pending', 'rejected')),
  submitted_batch_id uuid references public.rachandzach_upload_batches (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (original_bucket, original_object),
  -- Content-hash naming is the first line of overwrite protection: an object
  -- name must embed the first 16 hex chars of the file's sha256, so a
  -- different file can never legally claim the same object path.
  constraint rachandzach_photos_original_object_content_hash
    check (position(substr(file_sha256, 1, 16) in original_object) > 0)
);

create table public.rachandzach_photo_people (
  photo_id uuid not null references public.rachandzach_photos (id) on delete cascade,
  person_id uuid not null references public.rachandzach_people (id) on delete cascade,
  source text not null default 'embedded'
    check (source in ('embedded', 'confirmed', 'manual')),
  confidence text not null default 'confirmed'
    check (confidence in ('confirmed', 'uncertain', 'background')),
  created_at timestamptz not null default now(),
  primary key (photo_id, person_id)
);

create table public.rachandzach_photo_keywords (
  photo_id uuid not null references public.rachandzach_photos (id) on delete cascade,
  keyword text not null check (char_length(keyword) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (photo_id, keyword)
);

create table public.rachandzach_photo_previews (
  photo_id uuid not null references public.rachandzach_photos (id) on delete cascade,
  width int not null check (width > 0),
  format text not null check (format in ('avif', 'webp', 'jpeg')),
  bucket text not null default 'rachandzach-previews'
    check (bucket in ('rachandzach-previews', 'rachandzach-guest-approved')),
  object_path text not null unique
    check (object_path ~ '[0-9a-f]{16}'), -- content-hashed derivative names
  bytes bigint not null check (bytes > 0),
  created_at timestamptz not null default now(),
  primary key (photo_id, width, format)
);

-- ---------------------------------------------------------------------------
-- Guest uploads
-- ---------------------------------------------------------------------------

create table public.rachandzach_upload_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.rachandzach_upload_batches (id) on delete cascade,
  original_name text not null check (char_length(original_name) between 1 and 255),
  object_path text not null unique,
  bytes bigint not null
    check (bytes > 0 and bytes <= 52428800), -- 50 MB per file, mirrored at bucket level
  media_type text not null
    check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'removed')),
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Moderation and notifications
-- ---------------------------------------------------------------------------

create table public.rachandzach_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.rachandzach_upload_batches (id) on delete set null,
  item_id uuid references public.rachandzach_upload_items (id) on delete set null,
  actor_user_id uuid not null,
  action text not null check (action in (
    'approve_item', 'reject_item', 'restore_item',
    'approve_batch', 'reject_batch',
    'edit_metadata', 'move_object', 'delete_object'
  )),
  "before" jsonb not null default '{}'::jsonb,
  "after" jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.rachandzach_notification_log (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.rachandzach_upload_batches (id) on delete cascade,
  kind text not null check (kind in (
    'guest_receipt', 'admin_new_batch', 'guest_approved', 'guest_rejected'
  )),
  idempotency_key text not null unique,
  provider_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

create table public.rachandzach_rate_limit_buckets (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{32,64}$'),
  action text not null check (char_length(action) between 1 and 60),
  window_start timestamptz not null,
  attempts int not null default 0 check (attempts >= 0),
  primary key (key_hash, action, window_start)
);

-- ---------------------------------------------------------------------------
-- Minimal, non-identifying analytics
-- ---------------------------------------------------------------------------

-- Metadata guard: object-only, allowlisted keys, scalar values, short strings,
-- and no strings that resemble emails or URLs. Person names, email addresses,
-- photo URLs, and search text have no field to live in.
create or replace function public.rachandzach_gallery_event_metadata_is_allowed(metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(metadata) = 'object'
    and not exists (
      select 1
      from jsonb_each(metadata) as kv(key, value)
      where kv.key <> all (array['surface', 'event_slug', 'width_bucket', 'duration_ms', 'result_count', 'page', 'batch_size', 'item_count', 'status', 'source'])
        or jsonb_typeof(kv.value) in ('object', 'array')
        or (
          jsonb_typeof(kv.value) = 'string'
          and (
            char_length(kv.value #>> '{}') > 64
            or (kv.value #>> '{}') ~ '(@|://)'
          )
        )
    )
$$;

create table public.rachandzach_gallery_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null
    check (event_name in (
      'page_view', 'gallery_open', 'photo_view', 'photo_download',
      'favorite_add', 'favorite_remove', 'slideshow_start', 'slideshow_stop',
      'search_run', 'upload_start', 'upload_submit', 'my_weekend_view'
    )),
  anonymous_session_hash text
    check (anonymous_session_hash is null or anonymous_session_hash ~ '^[0-9a-f]{32,64}$'),
  photo_id uuid references public.rachandzach_photos (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
    check (public.rachandzach_gallery_event_metadata_is_allowed(metadata)),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger rachandzach_events_set_updated_at
  before update on public.rachandzach_events
  for each row execute function public.rachandzach_set_updated_at();

create trigger rachandzach_people_set_updated_at
  before update on public.rachandzach_people
  for each row execute function public.rachandzach_set_updated_at();

create trigger rachandzach_photos_set_updated_at
  before update on public.rachandzach_photos
  for each row execute function public.rachandzach_set_updated_at();

create trigger rachandzach_upload_batches_set_updated_at
  before update on public.rachandzach_upload_batches
  for each row execute function public.rachandzach_set_updated_at();

create trigger rachandzach_upload_items_set_updated_at
  before update on public.rachandzach_upload_items
  for each row execute function public.rachandzach_set_updated_at();

-- Keep rachandzach_people.photo_count in step with rachandzach_photo_people membership.
create or replace function public.rachandzach_bump_person_photo_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.rachandzach_people set photo_count = photo_count + 1 where id = new.person_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.rachandzach_people set photo_count = greatest(photo_count - 1, 0) where id = old.person_id;
    return old;
  end if;
  return null;
end
$$;

create trigger rachandzach_photo_people_bump_photo_count
  after insert or delete on public.rachandzach_photo_people
  for each row execute function public.rachandzach_bump_person_photo_count();

-- ---------------------------------------------------------------------------
-- Rate-limit consumption (server-only)
-- ---------------------------------------------------------------------------

-- KNOWN-SUPERSEDED DEFINITION: the ON CONFLICT column list below is ambiguous
-- against the same-named function parameters inside PL/pgSQL and errors with
-- SQLSTATE 42702 on every call. Migration 202607220004_rate_limit_conflict_fix
-- replaces this function (conflict target by constraint name) and is already
-- applied to the cloud project. This definition stays as-applied history; do
-- not "fix" it in place, and do not re-report the 42702 as an open bug.
create or replace function public.rachandzach_consume_rate_limit(
  key_hash text,
  action text,
  attempt_limit int,
  window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_attempts int;
begin
  if attempt_limit is null or attempt_limit <= 0
     or window_seconds is null or window_seconds <= 0 then
    raise exception 'attempt_limit and window_seconds must be positive';
  end if;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / window_seconds) * window_seconds
  );
  insert into public.rachandzach_rate_limit_buckets as b (key_hash, action, window_start, attempts)
  values (rachandzach_consume_rate_limit.key_hash, rachandzach_consume_rate_limit.action, v_window_start, 1)
  on conflict (key_hash, action, window_start)
  do update set attempts = b.attempts + 1
  returning b.attempts into v_attempts;
  return v_attempts <= attempt_limit;
end
$$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index rachandzach_photos_event_paging_idx on public.rachandzach_photos (event_id, captured_at, id);
create index rachandzach_photos_captured_at_idx on public.rachandzach_photos (captured_at);
create index rachandzach_photos_source_idx on public.rachandzach_photos (source);
create index rachandzach_photos_status_idx on public.rachandzach_photos (status);
create index rachandzach_photos_file_sha256_idx on public.rachandzach_photos (file_sha256);
create index rachandzach_photos_submitted_batch_idx on public.rachandzach_photos (submitted_batch_id);
create index rachandzach_photo_people_person_idx on public.rachandzach_photo_people (person_id);
create index rachandzach_photo_keywords_keyword_idx on public.rachandzach_photo_keywords (keyword);
create index rachandzach_upload_items_review_queue_idx on public.rachandzach_upload_items (status, batch_id);
create index rachandzach_upload_items_batch_idx on public.rachandzach_upload_items (batch_id);
create index rachandzach_upload_batches_review_queue_idx on public.rachandzach_upload_batches (status, submitted_at);
create index rachandzach_moderation_actions_batch_idx on public.rachandzach_moderation_actions (batch_id);
create index rachandzach_moderation_actions_item_idx on public.rachandzach_moderation_actions (item_id);
create index rachandzach_moderation_actions_created_idx on public.rachandzach_moderation_actions (created_at);
create index rachandzach_notification_log_batch_idx on public.rachandzach_notification_log (batch_id);
create index rachandzach_gallery_events_created_idx on public.rachandzach_gallery_events (created_at);
create index rachandzach_gallery_events_name_idx on public.rachandzach_gallery_events (event_name);
-- photo_id carries an on delete set null FK; without this index every photo
-- delete would seq-scan the analytics table.
create index rachandzach_gallery_events_photo_idx on public.rachandzach_gallery_events (photo_id);

-- ---------------------------------------------------------------------------
-- Default deny: RLS on everything, zero policies, privileges revoked.
-- The service role bypasses RLS; packet 04's server layer is the only door.
-- ---------------------------------------------------------------------------

alter table public.rachandzach_events enable row level security;
alter table public.rachandzach_people enable row level security;
alter table public.rachandzach_photos enable row level security;
alter table public.rachandzach_photo_people enable row level security;
alter table public.rachandzach_photo_keywords enable row level security;
alter table public.rachandzach_photo_previews enable row level security;
alter table public.rachandzach_upload_batches enable row level security;
alter table public.rachandzach_upload_items enable row level security;
alter table public.rachandzach_moderation_actions enable row level security;
alter table public.rachandzach_notification_log enable row level security;
alter table public.rachandzach_rate_limit_buckets enable row level security;
alter table public.rachandzach_gallery_events enable row level security;

-- Shared-project scoping: this database hosts other tenants' tables and
-- functions in schema public. Never use schema-wide statements such as
-- "revoke ... on all tables in schema public" here; they would strip grants
-- from objects this project does not own. Every revoke below names exactly
-- one rachandzach_ object created by this migration. Fail-closed intent is
-- preserved: anon and authenticated get nothing on these objects, and only
-- service_role (via packet 04's server layer) reaches them.

revoke all on table public.rachandzach_events from public, anon, authenticated;
revoke all on table public.rachandzach_people from public, anon, authenticated;
revoke all on table public.rachandzach_photos from public, anon, authenticated;
revoke all on table public.rachandzach_photo_people from public, anon, authenticated;
revoke all on table public.rachandzach_photo_keywords from public, anon, authenticated;
revoke all on table public.rachandzach_photo_previews from public, anon, authenticated;
revoke all on table public.rachandzach_upload_batches from public, anon, authenticated;
revoke all on table public.rachandzach_upload_items from public, anon, authenticated;
revoke all on table public.rachandzach_moderation_actions from public, anon, authenticated;
revoke all on table public.rachandzach_notification_log from public, anon, authenticated;
revoke all on table public.rachandzach_rate_limit_buckets from public, anon, authenticated;
revoke all on table public.rachandzach_gallery_events from public, anon, authenticated;

grant all on table public.rachandzach_events to service_role;
grant all on table public.rachandzach_people to service_role;
grant all on table public.rachandzach_photos to service_role;
grant all on table public.rachandzach_photo_people to service_role;
grant all on table public.rachandzach_photo_keywords to service_role;
grant all on table public.rachandzach_photo_previews to service_role;
grant all on table public.rachandzach_upload_batches to service_role;
grant all on table public.rachandzach_upload_items to service_role;
grant all on table public.rachandzach_moderation_actions to service_role;
grant all on table public.rachandzach_notification_log to service_role;
grant all on table public.rachandzach_rate_limit_buckets to service_role;
grant all on table public.rachandzach_gallery_events to service_role;

-- Helper functions created by this migration, same per-object treatment.
-- The two trigger-returning helpers cannot be called directly; revoking
-- execute removes the implicit PUBLIC grant without affecting the triggers,
-- which check execute privilege at creation time only.
revoke all on function public.rachandzach_set_updated_at() from public, anon, authenticated;
revoke all on function public.rachandzach_bump_person_photo_count() from public, anon, authenticated;
revoke all on function public.rachandzach_gallery_event_metadata_is_allowed(jsonb) from public, anon, authenticated;
grant execute on function public.rachandzach_gallery_event_metadata_is_allowed(jsonb) to service_role;

revoke all on function public.rachandzach_consume_rate_limit(text, text, int, int) from public, anon, authenticated;
grant execute on function public.rachandzach_consume_rate_limit(text, text, int, int) to service_role;
