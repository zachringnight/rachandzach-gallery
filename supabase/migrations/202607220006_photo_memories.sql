-- 202607220006_photo_memories.sql
-- Memories wall (Round Two): a guest attaches a short note to a SPECIFIC
-- photo, and the note appears on that photo only after Zach approves it.
-- Distinct from the batch-level upload note on rachandzach_upload_batches:
-- that one describes a whole submitted batch; this one belongs to a single
-- catalog photo and rides the same pending -> approved/rejected moderation
-- idea, in its own table.
--
-- Owner model mirrors rachandzach_guest_favorites
-- (202607220005_guest_favorites.sql): rows are keyed by (owner_kind,
-- owner_key) where owner_kind is
--   * 'session' -> owner_key is the anonymous guest session id
--     (GallerySession.sessionId, a random UUID minted server-side; never a
--     device identifier, never an email)
--   * 'person'  -> owner_key is a self-claimed rachandzach_people slug (the
--     My Weekend preference)
-- The owner key is only ever used server-side (attribution for moderation
-- and future cleanup); guests see display_name and body only. display_name
-- is the guest's own optional, self-chosen public byline.
--
-- Visibility contract: status 'pending' and 'rejected' rows are NEVER
-- guest-reachable. The guest read path (/api/memories) filters to
-- status = 'approved'; only /api/admin/memories surfaces the rest, behind
-- requireAdmin(). Enforced in the server layer and pinned by tests
-- (tests/memories/); the table itself is unreadable to guests either way
-- (RLS on, zero policies, service_role only).
--
-- No FK on owner_key (session ids live nowhere else, by design; sessions
-- are stateless signed cookies). photo_id does FK to rachandzach_photos so
-- memories die with their photo.
--
-- SHARED-PROJECT CONVENTION (see 202607220001_gallery_core.sql header):
-- every statement names only rachandzach_ objects; RLS on, zero policies;
-- per-object revokes from public/anon/authenticated; grants to service_role
-- only; no schema-wide statements; no functions here, so nothing needs a
-- pinned search_path.

create table public.rachandzach_photo_memories (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references public.rachandzach_photos (id) on delete cascade,
  owner_kind text not null check (owner_kind in ('session', 'person')),
  -- Session ids are 36-char UUIDs; person slugs are <= 120 chars (same bound
  -- as rachandzach_people.slug and rachandzach_guest_favorites.owner_key).
  owner_key text not null check (char_length(owner_key) between 1 and 120),
  -- Optional self-chosen public byline; null renders as an unattributed note.
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 500),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- The guest hot path: one photo's approved notes at once. status rides in
-- the index so the approved-only filter never rescans a busy photo's
-- pending pile.
create index rachandzach_photo_memories_photo_status_idx
  on public.rachandzach_photo_memories (photo_id, status);

-- The admin hot path: everything pending, across photos.
create index rachandzach_photo_memories_status_idx
  on public.rachandzach_photo_memories (status);

-- Default deny: RLS on, zero policies. Guests never touch this table
-- directly; the /api/memories and /api/admin/memories routes mediate all
-- access via the service role after requireGalleryAccess() / requireAdmin().
alter table public.rachandzach_photo_memories enable row level security;

-- Shared-project hygiene: Postgres/Supabase defaults re-grant anon and
-- authenticated on every new table, so revoke per object and grant only
-- service_role, exactly like the core migration's privileges section.
revoke all on table public.rachandzach_photo_memories from public, anon, authenticated;
grant all on table public.rachandzach_photo_memories to service_role;
