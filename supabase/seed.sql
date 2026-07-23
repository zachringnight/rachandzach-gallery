-- seed.sql -- synthetic records only.
-- No real guest names, emails, or photo identities appear here. Every value
-- is fabricated (fixed UUIDs, made-up hex hashes, "Sample" labels) so the
-- seed is deterministic and safe to commit. Real catalog rows come from the
-- read-only importer (packets 02 and 13), never from this file.

begin;

-- Synthetic rachandzach_events -------------------------------------------------------

insert into public.rachandzach_events (id, slug, name, sort_order, starts_at)
values
  ('00000000-0000-4000-8000-0000000000e1', 'sample-welcome-party', 'Sample Welcome Party', 1, '2025-07-18T22:00:00Z'),
  ('00000000-0000-4000-8000-0000000000e2', 'sample-ceremony', 'Sample Ceremony', 2, '2025-07-19T22:30:00Z');

-- Synthetic rachandzach_people -------------------------------------------------------

insert into public.rachandzach_people (id, slug, display_name, aliases)
values
  ('00000000-0000-4000-8000-0000000000a1', 'sample-guest-one', 'Sample Guest One', array['Sample G. One']),
  ('00000000-0000-4000-8000-0000000000a2', 'sample-guest-two', 'Sample Guest Two', '{}');

-- Synthetic rachandzach_photos -------------------------------------------------------
-- original_object embeds the first 16 hex chars of file_sha256, matching the
-- rachandzach_photos_original_object_content_hash constraint (content-hash naming).

insert into public.rachandzach_photos (
  id, image_data_hash, file_sha256, event_id,
  original_bucket, original_object, original_filename, original_bytes,
  width, height, captured_at, source, status
)
values
  (
    '00000000-0000-4000-8000-0000000000f1',
    '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    'a3f1c2d4e5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
    '00000000-0000-4000-8000-0000000000e1',
    'rachandzach-originals',
    'originals/sample-welcome-party/a3f1c2d4e5b60718-sample-0001.jpg',
    'sample-0001.jpg',
    7467766,
    10329, 7747,
    '2025-07-18T23:15:00Z',
    'master',
    'published'
  ),
  (
    '00000000-0000-4000-8000-0000000000f2',
    '1a2b3c4d5e6f708192a3b4c5d6e7f809',
    'b4a2d3c5f6e70819304b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9012',
    '00000000-0000-4000-8000-0000000000e2',
    'rachandzach-originals',
    'originals/sample-ceremony/b4a2d3c5f6e70819-sample-0002.jpg',
    'sample-0002.jpg',
    5242880,
    8192, 5464,
    '2025-07-19T23:00:00Z',
    'master',
    'published'
  );

-- Synthetic person tags and keywords ------------------------------------

insert into public.rachandzach_photo_people (photo_id, person_id, source, confidence)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a1', 'embedded', 'confirmed'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a2', 'confirmed', 'confirmed'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a1', 'embedded', 'uncertain');

insert into public.rachandzach_photo_keywords (photo_id, keyword)
values
  ('00000000-0000-4000-8000-0000000000f1', 'sample-dancing'),
  ('00000000-0000-4000-8000-0000000000f2', 'sample-vows');

-- Synthetic previews (content-hashed derivative names) --------------------

insert into public.rachandzach_photo_previews (photo_id, width, format, bucket, object_path, bytes)
values
  ('00000000-0000-4000-8000-0000000000f1', 1600, 'avif', 'rachandzach-previews', 'previews/1600/a3f1c2d4e5b60718293a4b5c6d7e8f90.avif', 245760),
  ('00000000-0000-4000-8000-0000000000f1', 480, 'webp', 'rachandzach-previews', 'previews/480/a3f1c2d4e5b60718293a4b5c6d7e8f90.webp', 40960),
  ('00000000-0000-4000-8000-0000000000f2', 1600, 'avif', 'rachandzach-previews', 'previews/1600/b4a2d3c5f6e70819304b5c6d7e8f90a1.avif', 220148);

-- Synthetic upload batch under review ------------------------------------
-- email intentionally null: no addresses, real or fake, live in seed data.

insert into public.rachandzach_upload_batches (id, receipt_hash, email, display_name, note, status, submitted_at)
values (
  '00000000-0000-4000-8000-0000000000b1',
  'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
  null,
  'Sample Uploader',
  'Synthetic batch for local review testing.',
  'submitted',
  '2025-07-20T01:00:00Z'
);

insert into public.rachandzach_upload_items (id, batch_id, original_name, object_path, bytes, media_type, sha256, status)
values (
  '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000b1',
  'sample-phone-photo.jpg',
  'pending/00000000-0000-4000-8000-0000000000b1/sample-phone-photo.jpg',
  1234567,
  'image/jpeg',
  'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2',
  'pending'
);

-- Synthetic moderation and notification history ---------------------------

insert into public.rachandzach_moderation_actions (id, batch_id, item_id, actor_user_id, action, "before", "after")
values (
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-00000000ad01',
  'edit_metadata',
  '{"status": "draft"}'::jsonb,
  '{"status": "submitted"}'::jsonb
);

insert into public.rachandzach_notification_log (id, batch_id, kind, idempotency_key, provider_id, status)
values (
  '00000000-0000-4000-8000-0000000000ee',
  '00000000-0000-4000-8000-0000000000b1',
  'admin_new_batch',
  'sample-batch-b1-admin_new_batch',
  null,
  'skipped'
);

-- Synthetic non-identifying analytics event -------------------------------

insert into public.rachandzach_gallery_events (id, event_name, anonymous_session_hash, photo_id, metadata)
values (
  '00000000-0000-4000-8000-0000000000aa',
  'photo_view',
  'abcdef0123456789abcdef0123456789',
  '00000000-0000-4000-8000-0000000000f1',
  '{"surface": "gallery", "event_slug": "sample-welcome-party", "duration_ms": 1500}'::jsonb
);

commit;
