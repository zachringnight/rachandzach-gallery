-- 202607220005_guest_favorites.sql
-- Server-side favorites persistence (Favorites v2). Favorites stay local-first
-- on the guest's device (src/lib/favorites/store.ts); this table is the sync
-- target so a guest's hearts survive a cleared browser and follow them across
-- devices once they claim a person on My Weekend.
--
-- Owner model: rows are keyed by (owner_kind, owner_key) where owner_kind is
--   * 'session' -> owner_key is the anonymous guest session id
--     (GallerySession.sessionId, a random UUID minted server-side; never a
--     device identifier, never an email)
--   * 'person'  -> owner_key is a self-claimed rachandzach_people slug (the
--     My Weekend preference). Anyone claiming the same person shares the same
--     favorites row set; in this password-gated wedding-guest context that is
--     accepted behavior, not a bug.
-- When a guest picks their person, the server unions their session rows into
-- the person key and deletes the session rows (see /api/favorites PUT).
--
-- No FK on owner_key: session ids are not stored anywhere else (by design;
-- sessions are stateless signed cookies) and person rows may be re-seeded by
-- slug. photo_id does FK to rachandzach_photos so favorite rows die with
-- their photo.
--
-- SHARED-PROJECT CONVENTION (see 202607220001_gallery_core.sql header):
-- every statement names only rachandzach_ objects; RLS on, zero policies;
-- per-object revokes from public/anon/authenticated; grants to service_role
-- only; no schema-wide statements; no functions here, so nothing needs a
-- pinned search_path.

create table public.rachandzach_guest_favorites (
  owner_kind text not null check (owner_kind in ('session', 'person')),
  -- Session ids are 36-char UUIDs; person slugs are <= 120 chars (same bound
  -- as rachandzach_people.slug).
  owner_key text not null check (char_length(owner_key) between 1 and 120),
  photo_id uuid not null references public.rachandzach_photos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_kind, owner_key, photo_id)
);

-- List-my-favorites is the hot path: one owner's whole row set at once.
create index rachandzach_guest_favorites_owner_idx
  on public.rachandzach_guest_favorites (owner_kind, owner_key);

-- Default deny: RLS on, zero policies. Guests never touch this table
-- directly; the /api/favorites routes mediate all access via the service
-- role after requireGalleryAccess().
alter table public.rachandzach_guest_favorites enable row level security;

-- Shared-project hygiene: Postgres/Supabase defaults re-grant anon and
-- authenticated on every new table, so revoke per object and grant only
-- service_role, exactly like the core migration's privileges section.
revoke all on table public.rachandzach_guest_favorites from public, anon, authenticated;
grant all on table public.rachandzach_guest_favorites to service_role;
