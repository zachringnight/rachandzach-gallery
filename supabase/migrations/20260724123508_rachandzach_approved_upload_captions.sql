-- 20260724123508_rachandzach_approved_upload_captions.sql
-- Persist the moderator's per-item uploader-note decision and copy an approved
-- batch note onto the published photo as a display-safe caption. The batch's
-- email is intentionally never copied into the catalog.

alter table public.rachandzach_upload_items
  add column note_approved boolean not null default false;

alter table public.rachandzach_photos
  add column uploader_caption text
    check (
      uploader_caption is null
      or char_length(uploader_caption) between 1 and 2000
    ),
  add column uploader_caption_byline text
    check (
      uploader_caption_byline is null
      or char_length(uploader_caption_byline) between 1 and 120
    ),
  add constraint rachandzach_photos_caption_byline_requires_caption
    check (
      uploader_caption_byline is null
      or uploader_caption is not null
    );

comment on column public.rachandzach_upload_items.note_approved is
  'The admin explicitly approved this item''s batch note for display with the published photo.';
comment on column public.rachandzach_photos.uploader_caption is
  'A trimmed guest batch note copied only after explicit admin approval.';
comment on column public.rachandzach_photos.uploader_caption_byline is
  'Optional uploader display name; never derived from the uploader email.';
