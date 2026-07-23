# Task 03: Supabase schema and storage rules

**Wave:** 1
**Depends on:** none

## Objective

Define the private media, catalog, upload, moderation, and audit model in migrations. Keep the design deployable to a dedicated Supabase project without touching any existing project during planning or local implementation.

## Files

- Create: supabase/config.toml
- Create: supabase/migrations/202607220001_gallery_core.sql
- Create: supabase/migrations/202607220002_storage_policies.sql
- Create: supabase/seed.sql
- Create: src/lib/supabase/browser.ts
- Create: src/lib/supabase/server.ts
- Create: src/lib/supabase/admin.ts
- Create: src/lib/supabase/database.types.ts
- Create: src/lib/supabase/schema.ts
- Create: tests/database/schema.test.ts
- Create: .env.example

## Interfaces

- Produces tables:
  - events(id uuid, slug text unique, name text, sort_order int, starts_at timestamptz null)
  - people(id uuid, slug text unique, display_name text, aliases text[], photo_count int)
  - photos(id uuid, image_data_hash text unique, file_sha256 text, event_id uuid, original_bucket text, original_object text, original_filename text, original_bytes bigint, width int, height int, captured_at timestamptz null, source text, status text, submitted_batch_id uuid null, approved_at timestamptz null)
  - photo_people(photo_id uuid, person_id uuid, source text, confidence text, primary key(photo_id, person_id))
  - photo_keywords(photo_id uuid, keyword text, primary key(photo_id,keyword))
  - photo_previews(photo_id uuid, width int, format text, bucket text, object_path text, bytes bigint, primary key(photo_id,width,format))
  - upload_batches(id uuid, receipt_hash text unique, email text null, display_name text null, note text null, status text, submitted_at timestamptz null, reviewed_at timestamptz null)
  - upload_items(id uuid, batch_id uuid, original_name text, object_path text unique, bytes bigint, media_type text, sha256 text null, status text, rejection_reason text null)
  - moderation_actions(id uuid, batch_id uuid null, item_id uuid null, actor_user_id uuid, action text, before jsonb, after jsonb, created_at timestamptz)
  - notification_log(id uuid, batch_id uuid, kind text, idempotency_key text unique, provider_id text null, status text, created_at timestamptz)
  - rate_limit_buckets(key_hash text, action text, window_start timestamptz, attempts int, primary key(key_hash,action,window_start))
  - gallery_events(id uuid, event_name text, anonymous_session_hash text null, photo_id uuid null, metadata jsonb, created_at timestamptz)
- Produces TypeScript types: Database, PhotoRow, PersonRow, UploadBatchRow, UploadItemRow.
- Produces: createBrowserClient() -> SupabaseClient<Database>
- Produces: createServerClient() -> Promise<SupabaseClient<Database>>
- Produces: createAdminClient() -> SupabaseClient<Database>, server-only.
- Produces: consume_rate_limit(key_hash text, action text, attempt_limit int, window_seconds int) -> boolean.
- Consumes: environment variables in .env.example. No actual secrets.

## Buckets and access

- wedding-originals: private, immutable source copies.
- wedding-previews: private, content-hashed display derivatives.
- guest-pending: private, no guest reads.
- guest-approved: private, approved guest originals and previews.
- download-exports: private, short-lived generated artifacts if later enabled.
- Guests never receive a service-role key.
- Guest access is mediated by packet 04 and short-lived signed URLs.
- Only the admin client can approve, reject, move, or delete objects.

## Steps

- [ ] Write a schema test that asserts constraints, enum checks, cascade behavior, and no anonymous table writes.
- [ ] Create the core migration with timestamps, constraints, indexes, and deterministic updated_at handling.
- [ ] Add storage bucket declarations and policies. Default deny wins.
- [ ] Prevent source object overwrites by policy and content-hash naming.
- [ ] Limit guest-pending MIME types and 50 MB object size at the bucket level.
- [ ] Add indexes for event paging, person joins, captured_at, source, status, file_sha256 for guest duplicate lookups, and upload review queues.
- [ ] Keep gallery_events optional and non-identifying. Constrain gallery_events.metadata to an allowlisted key set with scalar values via check constraint, so person names, emails, raw URLs, and search text have no field to live in.
- [ ] Generate database.types.ts from the local Supabase instance, not by hand.
- [ ] Seed only synthetic records. No real guest names or emails in seed.sql.
- [ ] Run Supabase database lint and security advisors locally where available.
- [ ] Report status. Do not create or mutate a cloud project.

## Done-check

Run: supabase db reset && npm run test -- tests/database/schema.test.ts

Expected: migrations and synthetic seed apply cleanly. The schema test passes. Anonymous direct writes to catalog, moderation, notification, and storage objects are denied.

## Report

Report DONE, DONE_WITH_CONCERNS, BLOCKED, or NEEDS_CONTEXT. Cloud project selection is intentionally deferred and is not a blocker for local completion.
