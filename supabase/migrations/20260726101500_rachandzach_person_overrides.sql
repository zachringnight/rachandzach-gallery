-- 20260726101500_rachandzach_person_overrides.sql
-- Admin-managed presentation overrides for the Find me guest roster.
--
-- The catalog (rachandzach_people + rachandzach_photo_people) stays the
-- source of truth for WHO IS TAGGED in photos. This table only decides who
-- is SURFACED on guest-facing pickers and how: a hand-picked face crop, a
-- corrected display name, a soft "hidden" flag, and admin-added people who
-- are not in the catalog at all. Nothing here deletes or mutates tag data,
-- favorites, or personalized routes.
--
-- CROP SCHEME (documented contract, mirrored in src/lib/people/face-types.ts
-- and scripts/build-face-thumbnails.mjs):
--   face_crop_x    = crop left edge  / image width          (0..1)
--   face_crop_y    = crop top  edge  / image height         (0..1)
--   face_crop_size = crop square side / min(width, height)  (0..1]
-- All three are fractions of the ORIGINAL photo pixel grid, so the same rect
-- applies to every derivative size without knowing absolute pixels. The crop
-- is always square in pixel space: side = face_crop_size * min(W, H).
--
-- The three crop columns travel together (all null or all set). The photo
-- reference uses ON DELETE SET NULL so removing a photo can never be blocked
-- by an override; readers treat a row whose photo id is null (or whose crop
-- trio is null) as "no usable face override" and fall back to the automatic
-- committed crop, then initials.

create table public.rachandzach_person_overrides (
  person_slug text primary key
    check (person_slug ~ '^[a-z0-9][a-z0-9-]*$' and char_length(person_slug) <= 80),
  -- Corrected display name; null = keep the catalog name.
  display_name text
    check (display_name is null or char_length(display_name) between 1 and 120),
  -- Soft removal from guest-facing pickers. Tags, favorites, and /{slug}
  -- personalized routes keep working; the person just stops being offered.
  hidden boolean not null default false,
  -- True for people added here who have no rachandzach_people catalog row.
  added boolean not null default false,
  face_photo_id uuid references public.rachandzach_photos (id) on delete set null,
  face_crop_x double precision
    check (face_crop_x is null or (face_crop_x >= 0 and face_crop_x <= 1)),
  face_crop_y double precision
    check (face_crop_y is null or (face_crop_y >= 0 and face_crop_y <= 1)),
  face_crop_size double precision
    check (face_crop_size is null or (face_crop_size > 0 and face_crop_size <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Admin allowlist email of the last writer (requireAdmin() actor).
  updated_by text not null check (char_length(updated_by) between 3 and 320),
  constraint rachandzach_person_overrides_crop_all_or_none check (
    (face_crop_x is null and face_crop_y is null and face_crop_size is null)
    or
    (face_crop_x is not null and face_crop_y is not null and face_crop_size is not null)
  ),
  -- A crop without a photo can only arise from ON DELETE SET NULL; a crop
  -- may never be INSERTED or UPDATED in without its photo. Enforced in the
  -- server layer (service role is the only writer); kept out of a CHECK so
  -- the FK's SET NULL action cannot be blocked by this table.
  constraint rachandzach_person_overrides_added_needs_name check (
    added = false or display_name is not null
  )
);

comment on table public.rachandzach_person_overrides is
  'Guest-facing presentation overrides: hand-picked face crops, display-name corrections, soft hiding, and admin-added people. The catalog stays the source of truth for photo tags.';
comment on column public.rachandzach_person_overrides.face_crop_x is
  'Crop left edge as a fraction of image width (0..1). Square crop: side = face_crop_size * min(width, height).';
comment on column public.rachandzach_person_overrides.face_crop_y is
  'Crop top edge as a fraction of image height (0..1).';
comment on column public.rachandzach_person_overrides.face_crop_size is
  'Crop square side as a fraction of the image''s shorter axis (0..1].';

create trigger rachandzach_person_overrides_touch
  before update on public.rachandzach_person_overrides
  for each row execute function public.rachandzach_set_updated_at();

-- Default deny, per the shared-project convention in
-- 202607220001_gallery_core.sql: RLS on, zero policies, and per-object
-- revokes (never schema-wide statements in this shared database). Only the
-- service role, behind requireAdmin()/server code, reaches this table.
alter table public.rachandzach_person_overrides enable row level security;
revoke all on table public.rachandzach_person_overrides from public, anon, authenticated;
grant all on table public.rachandzach_person_overrides to service_role;
