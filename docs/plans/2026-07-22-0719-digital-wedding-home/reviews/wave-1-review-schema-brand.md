# Wave 1 adversarial review: packet 03 (Supabase schema/storage) and packet 01 (brand/content)

Reviewer: static review only, nothing executed. Reviewed 2026-07-22 ~17:45 PT.
Rename state: the Wave 2 preflight rename to `rachandzach_` tables and `rachandzach-*` buckets completed mid-review (migration files updated 17:40). Everything below reviews the CURRENT, fully prefixed state, which is internally consistent across both migrations, seed.sql, database.types.ts, schema.ts, and tests/database/schema.test.ts. The rename itself is not flagged.

**Verdict: packet 03 lands DONE_WITH_CONCERNS, packet 01 lands DONE.** One high-severity plausible defect in the storage immutability trigger needs a fix before any real upload runs against these migrations. Everything else is medium or below.

---

## Findings, ranked

### 1. HIGH (plausible): immutability trigger likely blocks the storage service's own upload-finalize UPDATE, bricking all uploads to originals and previews

- File: `supabase/migrations/202607220002_storage_policies.sql:63-93` (`prevent_immutable_object_overwrite`)
- The trigger raises on any UPDATE in `rachandzach-originals` / `rachandzach-previews` where `version` or `metadata` changes. But Supabase storage-api commonly writes a new object as INSERT row first, then UPDATEs the same row with `version`/`metadata` when the byte transfer completes (both standard and TUS paths, exact behavior varies by storage-api version). If that pattern holds on the deployed stack, the FIRST upload into either bucket trips the trigger at finalize time.
- Failure scenario: packet 02/13 importer uploads the first master original via the admin client. The storage service's finalize UPDATE fires the trigger, the upload errors, and every subsequent upload into the immutable buckets fails the same way. The buckets can never be populated. The live test layer only exercises anon denial, not admin uploads into originals, so this ships unnoticed until the importer runs.
- Minimal fix: treat the first finalize as allowed. Add `and old.metadata is not null` to the guard condition (a not-yet-finalized row has null metadata), or narrow the guard to `name` / `bucket_id` changes plus `version` changes where `old.version is not null`. Keep the raise for genuine overwrites.
- Note: `assertNotOverwritingImmutableObject` in `src/lib/supabase/admin.ts:47-57` is the app-layer mirror and is correct as written (it checks object existence before upload, not row updates), so the fix is confined to the SQL trigger.

### 2. MEDIUM: privileges are revoked for existing objects only; future migrations silently regain default grants

- File: `supabase/migrations/202607220001_gallery_core.sql:361-362`
- `revoke all on all tables in schema public from anon, authenticated` and the functions equivalent cover only objects existing at migration time. Supabase's default privileges re-grant to `anon`/`authenticated` on tables and `PUBLIC` execute on functions created by later migrations (packet 04 onward). RLS-with-no-policies still denies rows on new tables, but a later `security definer` helper function would be anonymously executable by default, which is exactly the class of leak this migration is written to prevent.
- Failure scenario: packet 04 adds a security-definer session helper without remembering an explicit revoke; anon can call it directly.
- Minimal fix: add `alter default privileges in schema public revoke all on tables from anon, authenticated;` and `alter default privileges in schema public revoke execute on functions from public, anon, authenticated;` (for the roles that run migrations).

### 3. MEDIUM (coordination risk, not a present defect): the zero-storage-policy stance is asserted as final, but packet 08 has not chosen its TUS auth path, and the schema test hard-forbids the likely alternative

- Files: `supabase/migrations/202607220002_storage_policies.sql:6-11` (comment claims resumable uploads need no object policies), `docs/plans/.../packets/08-resumable-guest-uploads.md` step at line 65 (explicitly unresolved: options a/b/c), `tests/database/schema.test.ts:289-299` (rejects any storage policy granted `to anon|authenticated|public`).
- Signed upload URLs are single-shot PUTs, not TUS. If packet 08 lands on option (b), an RLS insert policy scoped to `rachandzach-guest-pending` for anon, that policy is exactly what the test forbids and what the migration comment says will never exist.
- Failure scenario: packet 08's builder adds the scoped policy, the schema test fails, and under time pressure someone either weakens the test wholesale or reverts the policy and breaks resumable uploads.
- Minimal fix: no code change now. Amend the migration comment to say "no policies UNLESS packet 08 selects option (b), in which case that packet must add a narrowly scoped insert-only policy AND deliberately update the default-deny test." Default deny as implemented today is correct.

### 4. LOW: `npm run types:generate` is documented and asserted but does not exist

- Files: `src/lib/supabase/database.types.ts:10-14` (regeneration instructions), `tests/database/schema.test.ts:352` (asserts the types file mentions the script), `package.json` (no `types:generate` script).
- Failure scenario: once Docker exists, someone follows the documented regen path and gets "missing script"; the hand-written types then drift from real generated output with no diff step.
- Minimal fix: add `"types:generate": "supabase gen types typescript --local > src/lib/supabase/database.types.ts"` to package.json. Related concern, already documented in the file header: database.types.ts is hand-written against the packet's "generate, not by hand" requirement because no container runtime exists. I diff-checked it against the migrations; table names, columns, nullability, FK relationships, and both function signatures match the current SQL. Keep the regenerate-and-diff step on the packet 12 checklist.

### 5. LOW: four functions have a mutable search_path (Supabase security advisor will flag them)

- File: `supabase/migrations/202607220001_gallery_core.sql` (`set_updated_at`, `bump_person_photo_count`, `gallery_event_metadata_is_allowed`) and `202607220002_storage_policies.sql` (`prevent_immutable_object_overwrite`).
- Only `rachandzach_consume_rate_limit` sets `search_path`. The others are not security definer and their bodies schema-qualify every table, so real exploitability is low, but the packet's own step ("run database lint and security advisors") will report `function_search_path_mutable` on all four.
- Minimal fix: append `set search_path = public, pg_temp` to each.

### 6. LOW: `rachandzach_gallery_events.photo_id` has no index despite an `on delete set null` FK

- File: `supabase/migrations/202607220001_gallery_core.sql:235` (FK), index block at 325-341 (no photo_id index).
- Every photo delete seq-scans gallery_events to null out references. Fine at current scale, degrades if analytics volume grows. Not in the packet's required index list, so a nit, not a spec violation.
- Minimal fix: `create index rachandzach_gallery_events_photo_idx on public.rachandzach_gallery_events (photo_id);`

### 7. LOW: admin client guard is runtime-only

- File: `src/lib/supabase/admin.ts:17-21`
- `typeof window !== "undefined"` throws in the browser at call time, after the module (and any co-bundled secrets-adjacent code) already shipped to the client bundle. A build-time fence is stronger.
- Minimal fix: add the `server-only` package and `import "server-only";` at the top of admin.ts so any client-graph import fails the build. Verified no current client code imports it (only `src/components/GalleryApp.tsx` is a client component and it does not touch admin.ts), so this is hardening, not a live leak.

### 8. LOW (verify with packet 05/07): fonts are declared but not attached, and the My Weekend nav item is not tied to the momentSearch flag

- Files: `src/components/brand/Wordmark.tsx:18-28` (Fraunces/Inter with `variable:` names), `src/app/layout.tsx:15-21` (current legacy layout attaches neither variable), `src/styles/tokens.css:35-36` (fallback chains), `src/content/site.ts:76` (My Weekend enabled, no flag).
- Fonts: until the packet 05 layout adds `displayFont.variable` and `bodyFont.variable` to `<html>`, `--font-display` silently resolves to the Iowan Old Style fallback everywhere except inside Wordmark itself (which applies `displayFont.className` directly). This is documented as a handoff in the Wordmark comment, so it is an intent to verify, not a bug: packet 05 must attach both variables or the site ships fallback typography with no error. Consider moving the font constants into a dedicated module (for example `src/styles/fonts.ts`) so the root layout does not have to import a component file.
- Nav: `/my-weekend` is enabled unconditionally while `momentSearch` is dev-only. If packet 07's page is substantially the moment-search experience, production nav will link to a page whose headline feature is flagged off. Verify the page has standalone non-search content in production, or tie the nav item to a flag.

---

## Clean areas (verified, no findings)

- **Contrast claims in tokens.css are accurate.** Recomputed WCAG ratios by hand against cream #F6F0E4: ink #282521 = 13.44:1 (claimed 13.4), muted #6B645A = 5.15:1 (claimed 5.1, passes AA), coral #D38377 = 2.54:1 and tan #AA8D66 = 2.76:1 (both correctly restricted to decorative use).
- **Content invariants all hold and no facts are invented.** All four required phrases present; "yes, even you" appears exactly once; every venue, address, time, and detail in site.ts (Hotel Californian 36 State St 6-9 PM, shuttles 3:30 / ceremony 4:30 / 10 PM end, Studio Sound Room 28 Anacapa St Unit C 10:30 PM-12:45 AM, sound ordinances at 10 PM, beach bungalow bar in the Funk Zone, Municipal Winemakers 22 Anacapa 9-11 AM, breakfast burritos and acai bowls) traces to rachandzach-sitemap-copy-ai-coder.pdf. No URLs, vendors, playlist names, or marathon details anywhere in content; the content test enforces this.
- **Flag wiring is correct.** `resolveFeatureFlags` is pure, momentSearch is development-only, the four unreleased flags are false in every environment, and tests/content/site-content.test.ts pins all of it including the ambient snapshot.
- **Tailwind 4 usage is safe.** `@import "tailwindcss" source(none)` with explicit `@source` globs (correctly excluding models/ and metadata/), `@theme inline` mapping to `--rz-*` source variables avoids the self-reference trap, postcss.config.mjs uses `@tailwindcss/postcss`, and the legacy `--sand`/`--muted` variables cannot collide with the namespaced tokens.
- **Brand SVG is verbatim.** public/brand/0719-co-outline.svg is byte-identical (whitespace-insensitive diff, same 1808 bytes) to the canonical /Users/zsoskin/Documents/0719+co outline.svg.
- **Default deny on tables is real.** RLS enabled on all 12 tables, zero policies, table and function privileges revoked, `rachandzach_consume_rate_limit` is security definer with pinned search_path, revoked from public/anon/authenticated and granted only to service_role, and its upsert-increment is race-safe.
- **Packet 03 constraint and index list is fully delivered.** All enum-style checks, hash format checks, the content-hash object-naming constraint, unique keys, composite PKs, 50 MB and MIME caps at table AND bucket AND config.toml level, and every required index including `rachandzach_photos_file_sha256_idx`.
- **The gallery_events metadata allowlist is tight.** Object-only, allowlisted keys, scalars only, 64-char string cap, rejects "@" and "://", and the schema test cross-checks the SQL key array against the TypeScript constant exactly.
- **seed.sql applies cleanly against the renamed schema and is synthetic only.** Prefixed table and bucket names match the migrations, both photo object paths embed the first 16 sha256 hex chars, all hash formats pass their checks, metadata uses only allowlisted keys, email is null, and no real names or addresses appear.
- **Client split is sound.** Browser and server clients are anon-key-only and fail closed; the service role key appears in exactly one file (admin.ts); .env.example is placeholders only with the service key correctly unprefixed (I did not read .env.cloud).

## Note for the packet 03 report

Findings 1 and 2 are the only ones that should gate cloud deployment. Finding 1 must be resolved (or affirmatively disproven against the deployed storage-api version, then documented in the migration comment) before the packet 02/13 importer first runs against a real stack.
