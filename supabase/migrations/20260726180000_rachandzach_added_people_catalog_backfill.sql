-- 20260726180000_rachandzach_added_people_catalog_backfill.sql
-- Admin-added people become real catalog identities.
--
-- Until now, "Add a person" on /admin/faces created only a
-- rachandzach_person_overrides row (added = true) with no rachandzach_people
-- row. Such a person could be surfaced in pickers but never tagged into a
-- photograph: confirmed tags live in rachandzach_photo_people, whose
-- person_id references the catalog, and the tagging surfaces resolve slugs
-- against rachandzach_people. The owner has decided added people are full,
-- taggable identities, so the server now creates the catalog row at add time
-- (catalog first, override second, so a partial failure can never leave an
-- added override without a catalog row).
--
-- This backfill upgrades any override-only people created before that
-- change. Additive only: it INSERTs missing rachandzach_people rows and
-- touches nothing else. The override row keeps its roles (face crop, rename,
-- hidden flag, and the added = true provenance marker). Both slug and
-- display_name already satisfy the catalog's checks: the overrides table
-- enforces the same slug pattern (capped at 80 chars) and the same 1..120
-- display-name length, and added = true rows are constrained to have a
-- display name.
--
-- Invariant from here on: every rachandzach_person_overrides row with
-- added = true has a matching rachandzach_people row. (Recorded here rather
-- than as a foreign key because rachandzach_person_overrides pre-exists this
-- migration and this shared database's rules forbid altering existing
-- tables; the server layer is the only writer and maintains it.)

insert into public.rachandzach_people (slug, display_name)
select o.person_slug, o.display_name
from public.rachandzach_person_overrides o
where o.added
  and o.display_name is not null
  and not exists (
    select 1
    from public.rachandzach_people p
    where p.slug = o.person_slug
  );
