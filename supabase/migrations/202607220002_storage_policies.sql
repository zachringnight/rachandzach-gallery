-- 202607220002_storage_policies.sql
-- Private storage buckets and default-deny object rules.
--
-- Access model:
--   * Every bucket is private. Browsers only ever see short-lived signed URLs
--     minted server-side (packet 04). Guests never hold a service-role key.
--   * storage.objects keeps RLS enabled with ZERO policies for anon or
--     authenticated: default deny wins. The admin (service-role) client is
--     the only principal that can approve, reject, move, or delete objects,
--     and resumable guest uploads use server-minted signed upload tokens,
--     which do not require object policies.
--   * rachandzach-originals and rachandzach-previews are immutable: content-hash
--     naming (enforced in 202607220001) plus a BEFORE UPDATE trigger stop
--     overwrites even by the service role.

-- ---------------------------------------------------------------------------
-- Buckets (id, name, public, file_size_limit, allowed_mime_types)
-- rachandzach-guest-pending and rachandzach-guest-approved are capped at 50 MB per object and accept
-- only JPEG, PNG, WebP, and HEIC -- enforced by the storage service at the
-- bucket level, before any application code runs.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('rachandzach-originals', 'rachandzach-originals', false, null, null),
  ('rachandzach-previews', 'rachandzach-previews', false, null, null),
  ('rachandzach-guest-pending', 'rachandzach-guest-pending', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('rachandzach-guest-approved', 'rachandzach-guest-approved', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('rachandzach-download-exports', 'rachandzach-download-exports', false, null, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Default deny on storage.objects.
-- RLS is enabled by default on Supabase; we re-assert it defensively. No
-- CREATE POLICY statements follow on purpose: with RLS on and no policies,
-- anon and authenticated are denied every operation. Wrapped in a DO block
-- because hosted projects may restrict DDL on the storage schema; local
-- stacks run this as-is.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table storage.objects enable row level security';
exception
  when insufficient_privilege then
    raise notice 'storage.objects RLS could not be altered by this role; '
      'Supabase keeps RLS enabled by default. Verify in the dashboard.';
end
$$;

-- ---------------------------------------------------------------------------
-- Immutability trigger for source objects.
-- Content-hash naming makes overwrites pointless; this trigger makes them
-- impossible. Renames, moves, and content-version changes are all blocked in
-- rachandzach-originals and rachandzach-previews once an object is finalized.
-- The storage service finalizes an upload with its own UPDATE on the row it
-- inserted (setting version/metadata when the byte transfer completes), so
-- the first finalize (old.metadata is null) must pass or no upload into
-- these buckets could ever succeed. Bookkeeping-only row updates (for
-- example last_accessed_at) are still allowed. Deletion stays possible for
-- the admin client only (no policies grant it to anyone else).
-- ---------------------------------------------------------------------------

create or replace function public.rachandzach_prevent_immutable_object_overwrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Tenant guard: storage.objects is shared with every other project on this
  -- Supabase instance. Any object outside the five rachandzach- buckets is
  -- not ours; pass it through untouched so other tenants' storage behavior
  -- is never affected by this trigger.
  if old.bucket_id not in (
    'rachandzach-originals',
    'rachandzach-previews',
    'rachandzach-guest-pending',
    'rachandzach-guest-approved',
    'rachandzach-download-exports'
  ) then
    return new;
  end if;
  -- old.metadata is not null distinguishes a finalized object from a row the
  -- storage service is still finalizing; the first finalize UPDATE is allowed,
  -- every later mutation of name, bucket, version, or metadata is not.
  if old.bucket_id in ('rachandzach-originals', 'rachandzach-previews')
    and old.metadata is not null
    and (
    new.name is distinct from old.name
    or new.bucket_id is distinct from old.bucket_id
    or new.version is distinct from old.version
    or new.metadata is distinct from old.metadata
  ) then
    raise exception 'objects in bucket % are immutable; upload under a new content-hash name instead of overwriting %',
      old.bucket_id, old.name
      using errcode = 'raise_exception';
  end if;
  return new;
end
$$;

-- Same per-object privilege hygiene as the core migration: remove the
-- implicit PUBLIC execute grant. Trigger firing is unaffected (execute is
-- checked at trigger creation time only).
revoke all on function public.rachandzach_prevent_immutable_object_overwrite() from public, anon, authenticated;

do $$
begin
  -- Drop only our own prefixed trigger name. Never drop a generic name here:
  -- another tenant on this shared project could own it. The WHEN clause keeps
  -- the trigger from even firing for objects outside our five buckets; the
  -- function body repeats the same guard as defense in depth.
  execute 'drop trigger if exists rachandzach_storage_objects_prevent_overwrite on storage.objects';
  execute 'create trigger rachandzach_storage_objects_prevent_overwrite '
    'before update on storage.objects '
    'for each row '
    'when (old.bucket_id in ('
      '''rachandzach-originals'', ''rachandzach-previews'', ''rachandzach-guest-pending'', '
      '''rachandzach-guest-approved'', ''rachandzach-download-exports'')) '
    'execute function public.rachandzach_prevent_immutable_object_overwrite()';
exception
  when insufficient_privilege then
    raise notice 'could not attach overwrite trigger to storage.objects (restricted storage schema); '
      'falling back to content-hash naming plus the application-layer guard in the admin client.';
end
$$;
