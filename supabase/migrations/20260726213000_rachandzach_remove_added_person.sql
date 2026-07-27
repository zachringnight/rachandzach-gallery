-- 20260726213000_rachandzach_remove_added_person.sql
-- Atomic, reference-aware removal of an admin-added person.
--
-- WHY THIS EXISTS. removePerson (src/lib/admin/people-server.ts) previously
-- ran countPersonPhotoLinks() and the catalog delete as two separate
-- statements. Two data-loss paths followed:
--
--   1. RACE: a rachandzach_photo_people row inserted between the zero-link
--      check and the delete was destroyed by the person_id FK's ON DELETE
--      CASCADE, so a confirmed tag could vanish even though the product
--      promises a concurrent tag degrades deletion into a soft hide.
--   2. FAVORITES: rachandzach_guest_favorites rows keyed
--      (owner_kind = 'person', owner_key = slug) exist independently of
--      photo tags. Deleting the catalog row made resolveFavoriteOwner
--      reject the slug forever, permanently stranding a guest's shortlist.
--
-- THE RULE. An added person may be hard-deleted only when, at the moment of
-- deletion and atomically, nothing durable references the identity: zero
-- rachandzach_photo_people rows AND zero person-keyed
-- rachandzach_guest_favorites rows. Any reference means the server keeps the
-- identity and the caller soft-hides it instead. Pipeline-matched people
-- (no added = true override) are never deleted here at all.
-- rachandzach_photo_memories intentionally does NOT gate deletion: its
-- person-keyed owner column is server-side attribution only; guests reach
-- memories by photo + approved status, so removing the identity strands
-- nothing a guest can see.
--
-- WHY IT IS RACE-FREE. The function first locks the rachandzach_people row
-- FOR UPDATE. A concurrent tag insert must take FOR KEY SHARE on that same
-- row for its person_id FK, and FOR KEY SHARE conflicts with FOR UPDATE, so
-- exactly one of two interleavings is possible:
--   * the tagger commits first: this function blocks on the lock, then its
--     reference checks (fresh snapshot per statement under read committed)
--     see the committed tag and the person is kept;
--   * this function commits first: the tagger blocks on the lock and, if the
--     person was deleted, fails its FK instead of silently losing the tag.
-- A confirmed tag can therefore never be cascade-deleted by this path.
-- Favorites have no FK to rachandzach_people (session keys live nowhere
-- else, by design), so a favorite written by a request in flight during the
-- delete cannot be serialized here; that residual is closed on the read side
-- instead (resolveFavoriteOwner keeps any slug that already owns favorite
-- rows resolvable, catalog row or not).
--
-- SHARED-PROJECT CONVENTION (see 202607220001_gallery_core.sql header):
-- additive only, names only rachandzach_ objects, per-object revokes, grant
-- to service_role only, pinned search_path.

create function public.rachandzach_remove_added_person(p_slug text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_person_id uuid;
begin
  -- Serialization point: see the header. Everything below happens while no
  -- new photo-person link can reference this row.
  select id into v_person_id
  from public.rachandzach_people
  where slug = p_slug
  for update;

  if v_person_id is null then
    return 'missing';
  end if;

  -- Only identities created from /admin/faces carry added = true. This is
  -- re-checked here so the function can never delete a pipeline-matched
  -- person even if called with the wrong slug.
  if not exists (
    select 1
    from public.rachandzach_person_overrides o
    where o.person_slug = p_slug
      and o.added
  ) then
    return 'kept';
  end if;

  if exists (
    select 1
    from public.rachandzach_photo_people pp
    where pp.person_id = v_person_id
  ) then
    return 'kept';
  end if;

  if exists (
    select 1
    from public.rachandzach_guest_favorites f
    where f.owner_kind = 'person'
      and f.owner_key = p_slug
  ) then
    return 'kept';
  end if;

  -- Nothing durable references the identity; both rows go in one
  -- transaction. Photographs are untouched by construction: nothing here
  -- names rachandzach_photos.
  delete from public.rachandzach_person_overrides where person_slug = p_slug;
  delete from public.rachandzach_people where id = v_person_id;
  return 'deleted';
end;
$$;

comment on function public.rachandzach_remove_added_person(text) is
  'Deletes an admin-added person only when zero photo tags and zero person-keyed favorites reference them, atomically (FOR UPDATE on the catalog row serializes against tag inserts via the person_id FK). Returns deleted, kept, or missing; kept means the caller must soft-hide instead.';

revoke all on function public.rachandzach_remove_added_person(text) from public, anon, authenticated;
grant execute on function public.rachandzach_remove_added_person(text) to service_role;
