-- 20260724124851_rachandzach_photo_processing_gate.sql
-- A guest photo stays non-visible until its deterministic storage objects and
-- every catalog relation have finished staging. Existing catalog photos are
-- already complete, so the default safely backfills them to true.

alter table public.rachandzach_photos
  add column processing_complete boolean not null default true;

comment on column public.rachandzach_photos.processing_complete is
  'False only while a guest photo is being staged; gallery publication requires all preview and metadata writes to finish first.';
