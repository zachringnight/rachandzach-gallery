# Cloud Schema Verification: rachandzach gallery on PrizmLounge

Date: 2026-07-22 (PT). Project: PrizmLounge (rnfvmqflktghriqefatc), shared with ~200 tables owned by other apps. Scope limited strictly to rachandzach_ objects and rachandzach- buckets.

## Verdict: ONE BLOCKING ISSUE. NOT SAFE TO SYNC until fixed.

The applied cloud schema matches the local sources of truth exactly (zero drift), and every fail-closed and metadata-guard probe behaved correctly. But check 3 failed: `public.rachandzach_consume_rate_limit` raises an error on every invocation. The bug is in the migration source itself, so it exists identically in local and cloud. Any server code path that calls the rate limiter will throw instead of rate limiting.

### The blocking issue

Every call to the function fails:

```
select public.rachandzach_consume_rate_limit('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'verify_smoke', 1, 60);

ERROR:  42702: column reference "key_hash" is ambiguous
DETAIL:  It could refer to either a PL/pgSQL variable or a table column.
QUERY:  insert into public.rachandzach_rate_limit_buckets as b (key_hash, action, window_start, attempts)
  values (rachandzach_consume_rate_limit.key_hash, rachandzach_consume_rate_limit.action, v_window_start, 1)
  on conflict (key_hash, action, window_start)
  do update set attempts = b.attempts + 1
  returning b.attempts
CONTEXT:  PL/pgSQL function rachandzach_consume_rate_limit(text,text,integer,integer) line 13 at SQL statement
```

Root cause: the `on conflict (key_hash, action, window_start)` index-inference column list is parsed as expressions inside PL/pgSQL, so `key_hash` and `action` are ambiguous between the function parameters and the table columns. The VALUES clause is correctly qualified; the conflict target is not, and conflict-target columns cannot be table-qualified. Fix options (pick one, in `supabase/migrations/202607220001_gallery_core.sql` and re-apply):

1. `on conflict on constraint rachandzach_rate_limit_buckets_pkey` (smallest diff, names an object this project owns).
2. Rename the function parameters to `p_key_hash`, `p_action`, etc.
3. Add `#variable_conflict use_column` at the top of the function body.

Everything below passed.

## Check 1: Drift (cloud vs supabase/migrations/*.sql and src/lib/supabase/database.types.ts)

Compared via `list_tables` (public schema, filtered to rachandzach_) plus targeted pg_catalog queries (pg_attribute, pg_attrdef, pg_constraint with pg_get_constraintdef, pg_indexes, pg_proc, pg_trigger with pg_get_triggerdef, pg_policies, information_schema.role_table_grants).

**Tables: all 12 present, no extras, RLS enabled on every one, 0 rows each.**
rachandzach_events, rachandzach_people, rachandzach_upload_batches, rachandzach_photos, rachandzach_photo_people, rachandzach_photo_keywords, rachandzach_photo_previews, rachandzach_upload_items, rachandzach_moderation_actions, rachandzach_notification_log, rachandzach_rate_limit_buckets, rachandzach_gallery_events.

**Columns**: every column name, type, nullability, and default matches the migration and database.types.ts exactly. Spot list of the load-bearing ones, all confirmed:
- rachandzach_photos: 17 columns; `original_bucket text not null default 'rachandzach-originals'`, `original_bytes bigint`, `width`/`height` nullable int, uuid PKs defaulting to `gen_random_uuid()`.
- rachandzach_gallery_events: `metadata jsonb not null default '{}'::jsonb`.
- rachandzach_rate_limit_buckets: 4 columns, `attempts int not null default 0`.

**Check constraints**: all present with matching definitions, including:
- `rachandzach_photos_original_object_content_hash`: `CHECK ((POSITION((substr(file_sha256, 1, 16)) IN (original_object)) > 0))`
- `rachandzach_gallery_events_metadata_check`: `CHECK (rachandzach_gallery_event_metadata_is_allowed(metadata))`
- All enum-style status/source/kind/action/format checks, hash regex checks (`^[0-9a-f]{32,64}$`, `^[0-9a-f]{64}$`), slug regexes, length bounds, `bytes > 0 and bytes <= 52428800`, email regex on upload_batches.

**Primary keys, uniques, FKs**: all match, including composite PKs (photo_people, photo_keywords, photo_previews, rate_limit_buckets), `unique (original_bucket, original_object)`, unique slug/receipt_hash/idempotency_key/object_path/image_data_hash, and all 11 FKs with correct on delete behavior (restrict on photos.event_id, set null on submitted_batch_id / moderation FKs / gallery_events.photo_id, cascade on the rest). FK constraint names match database.types.ts Relationships exactly.

**Indexes**: all 18 secondary indexes from the migration exist with matching definitions (event_paging, captured_at, source, status, file_sha256, submitted_batch on photos; person_idx; keyword_idx; both review_queue indexes; batch_idx on upload_items; the three moderation_actions indexes; notification_log batch_idx; gallery_events created/name/photo). No unexpected indexes beyond PK/unique backing indexes.

**Functions**: all 5 present with matching signatures and attributes:
| function | returns | secdef | volatility | search_path |
|---|---|---|---|---|
| rachandzach_set_updated_at() | trigger | no | volatile | '' |
| rachandzach_bump_person_photo_count() | trigger | no | volatile | '' |
| rachandzach_gallery_event_metadata_is_allowed(jsonb) | boolean | no | immutable | '' |
| rachandzach_consume_rate_limit(text,text,int,int) | boolean | yes | volatile | public, pg_temp |
| rachandzach_prevent_immutable_object_overwrite() | trigger | no | volatile | '' |

**Triggers**: all 6 public-schema triggers present (5 set_updated_at + photo_people bump), definitions match.

**Grants (fail-closed posture)**: on every one of the 12 tables, only `postgres` and `service_role` hold privileges. No grants to public, anon, or authenticated. Function ACLs are `{postgres=X/postgres,service_role=X/postgres}` on all 5 functions: no PUBLIC, anon, or authenticated execute anywhere. **Zero RLS policies** exist on any rachandzach_ table and zero rachandzach policies on storage.objects: RLS on + no policies = default deny, as designed.

One benign delta vs the letter of the migration: the three trigger-returning functions carry execute for service_role (from the project's default privileges; the migration only revokes public/anon/authenticated on them and grants service_role nothing). Harmless: trigger functions cannot be called directly by anyone, and anon/authenticated hold nothing.

**Drift verdict: NO DRIFT.** Cloud matches both local sources exactly, including the broken rate-limit function body (the 42702 bug is faithful to source).

## Check 2: Fail-closed probes (role simulation, single statement batch each)

Each probe ran as `begin; set local role <role>; <statement>; rollback;`. All five failed exactly as required, with permission denied (SQLSTATE 42501), which proves revoked grants deny before RLS is even consulted. Exact errors:

anon, select rachandzach_photos:
```
ERROR:  42501: permission denied for table rachandzach_photos
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.rachandzach_photos TO anon;
```

anon, select rachandzach_people:
```
ERROR:  42501: permission denied for table rachandzach_people
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.rachandzach_people TO anon;
```

anon, select rachandzach_upload_batches:
```
ERROR:  42501: permission denied for table rachandzach_upload_batches
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.rachandzach_upload_batches TO anon;
```

anon, insert rachandzach_gallery_events:
```
ERROR:  42501: permission denied for table rachandzach_gallery_events
HINT:  Grant the required privileges to the current role with: GRANT INSERT ON public.rachandzach_gallery_events TO anon;
```

authenticated, select rachandzach_photos:
```
ERROR:  42501: permission denied for table rachandzach_photos
HINT:  Grant the required privileges to the current role with: GRANT SELECT ON public.rachandzach_photos TO authenticated;
```

**Result: PASS. Fully fail-closed for anon and authenticated.**

## Check 3: Function smoke (default postgres role)

**Result: FAIL.** Expected `true` then `false` from two calls of `rachandzach_consume_rate_limit('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'verify_smoke', 1, 60)` in the same window. Both invocation attempts (a two-call CTE form and a plain single call) raised the 42702 ambiguity error quoted in the verdict section. The function never reaches its return.

Cleanup: the failed inserts aborted their own transactions, so nothing persisted. The prescribed cleanup ran anyway:
```
delete from public.rachandzach_rate_limit_buckets where action = 'verify_smoke';
select count(*) from public.rachandzach_rate_limit_buckets where action = 'verify_smoke';
-- remaining_smoke_rows: 0
```
No verify_smoke rows remain. These deletes plus the two rolled-back check-5 inserts were the only writes performed.

## Check 4: Storage trigger and buckets

Trigger exists on storage.objects with the WHEN clause listing exactly the five rachandzach- buckets and no others:
```
CREATE TRIGGER rachandzach_storage_objects_prevent_overwrite BEFORE UPDATE ON storage.objects
FOR EACH ROW WHEN ((old.bucket_id = ANY (ARRAY['rachandzach-originals'::text, 'rachandzach-previews'::text,
'rachandzach-guest-pending'::text, 'rachandzach-guest-approved'::text, 'rachandzach-download-exports'::text])))
EXECUTE FUNCTION rachandzach_prevent_immutable_object_overwrite()
```

Buckets (from storage.buckets, filtered to rachandzach-):
| id | public | file_size_limit | allowed_mime_types |
|---|---|---|---|
| rachandzach-download-exports | false | null | null |
| rachandzach-guest-approved | false | 52428800 | image/jpeg, image/png, image/webp, image/heic |
| rachandzach-guest-pending | false | 52428800 | image/jpeg, image/png, image/webp, image/heic |
| rachandzach-originals | false | null | null |
| rachandzach-previews | false | null | null |

All five exist, all private, limits and MIME lists exactly as the migration specifies. **Result: PASS.**

## Check 5: Metadata guard (postgres role, rolled-back transactions)

Disallowed key rejected. `insert ... values ('search_run', '{"q":"john smith"}'::jsonb)` inside begin/rollback:
```
ERROR:  23514: new row for relation "rachandzach_gallery_events" violates check constraint "rachandzach_gallery_events_metadata_check"
DETAIL:  Failing row contains (df108ec5-..., search_run, null, null, {"q": "john smith"}, 2026-07-23 01:00:50.870976+00).
```

Allowed key accepted. `insert ... values ('page_view', '{"surface":"gallery"}'::jsonb)` in the same begin/rollback batch completed without error, and a post-rollback count confirmed nothing persisted:
```
rows_after_rollback: 0
```

**Result: PASS.** Search text has no field to live in; allowlisted metadata passes.

## Out-of-scope observation (not acted on)

The Supabase tooling flagged that 33 tables elsewhere in this shared project (vh_survivor_*, wc_tour_stops and other wc_ location tables, leaguel_*, athlete_outreach, ig_post_analytics, _b64_stage, _ugc_fresh_*) have RLS disabled. None are rachandzach_ tables and none were touched; flagged here only so the project owner is aware. Every rachandzach_ table has RLS enabled.

## Required action before sync

Fix `rachandzach_consume_rate_limit` in `supabase/migrations/202607220001_gallery_core.sql` (preferred: `on conflict on constraint rachandzach_rate_limit_buckets_pkey`), re-apply to cloud, and re-run the check 3 smoke (true, then false, then cleanup). Everything else verified clean.
