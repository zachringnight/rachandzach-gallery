-- 20260726233000_rachandzach_add_person.sql
-- Atomic creation of an admin-added person: catalog identity plus the
-- added = true provenance override, in one transaction.
--
-- WHY THIS EXISTS. addPerson (src/lib/admin/people-server.ts) previously ran
-- two inserts as two separate transactions: the rachandzach_people row
-- first, then the rachandzach_person_overrides row. When the override insert
-- failed, a compensating unconditional DELETE of the catalog row ran in yet
-- another transaction. Two data-loss paths followed (both reproduced against
-- this database before this migration was written):
--
--   1. RACE: between the catalog commit and the compensation, /admin/catalog
--      could already read the new person and insert a
--      rachandzach_photo_people tag. That table's person_id FK is ON DELETE
--      CASCADE, so the compensating delete silently destroyed a freshly
--      committed tag -- the mirror image of the remove-side race that
--      20260726213000_rachandzach_remove_added_person.sql closed.
--   2. LOST RESPONSE: if the override insert actually committed but its
--      response never reached the server, the compensation still deleted the
--      catalog row, leaving an added = true override with no identity behind
--      it -- the one state guest surfaces no longer guard against.
--
-- THE RULE. Both rows are written inside this single function, so the person
-- either exists fully (catalog row + added override) or not at all. There is
-- no window in which a tagger can reference a row that a later compensation
-- might delete, because no compensating delete exists anywhere in the add
-- path any more.
--
-- WHY IT IS RACE-FREE. The person id is generated inside this transaction
-- and becomes visible to any other session only at commit, after BOTH rows
-- exist. A tag insert therefore either references a fully created person
-- (both rows committed, nothing will delete them) or fails its FK because
-- the person never became visible; a half-created person cannot be observed.
--
-- DUPLICATES. The unique index on rachandzach_people.slug and the
-- rachandzach_person_overrides primary key remain the authoritative
-- collision checks. Any unique violation -- catalog slug taken, or an
-- override row (including a pre-backfill orphan) already claiming the slug
-- -- rolls back BOTH inserts via the exception block's implicit
-- subtransaction and reports 'duplicate', which the server maps to the same
-- 409 its friendlier pre-check produces.
--
-- photo_count is intentionally not written: the catalog trigger owns it and
-- it stays 0 until tags arrive. Nothing here names rachandzach_photos.
--
-- SHARED-PROJECT CONVENTION (see 202607220001_gallery_core.sql header):
-- additive only, names only rachandzach_ objects, per-object revokes, grant
-- to service_role only, pinned search_path.

create function public.rachandzach_add_person(
  p_slug text,
  p_display_name text,
  p_actor text
)
returns text
language plpgsql
set search_path = ''
as $$
begin
  insert into public.rachandzach_people (slug, display_name)
  values (p_slug, p_display_name);

  insert into public.rachandzach_person_overrides
    (person_slug, display_name, added, updated_by)
  values (p_slug, p_display_name, true, p_actor);

  return 'added';
exception when unique_violation then
  -- Either the slug already names a catalog person or an override row
  -- already claims it. The subtransaction rollback undoes the catalog
  -- insert too, so no partial state ever escapes this function.
  return 'duplicate';
end;
$$;

comment on function public.rachandzach_add_person(text, text, text) is
  'Creates an admin-added person atomically: the rachandzach_people catalog row and the added = true rachandzach_person_overrides row commit together or not at all, so no tagger can ever reference a half-created person that a compensation later deletes. Returns added, or duplicate when either row''s uniqueness is violated (both inserts rolled back).';

revoke all on function public.rachandzach_add_person(text, text, text) from public, anon, authenticated;
grant execute on function public.rachandzach_add_person(text, text, text) to service_role;
