# Spike: Cloud readiness for the gated migration apply

**Date:** 2026-07-22 (live queries, read-only)
**Targets:** Supabase project PrizmLounge (`rnfvmqflktghriqefatc`, Postgres 17.6) and Vercel team `zach soskin's projects`
**Verdict: GO for the migration-apply step.** No blockers found. Two launch-checklist items (global storage upload cap, custom SMTP) and one apply-time versioning rule, detailed below.

## Scorecard

| # | Item | Verdict |
|---|------|---------|
| 1 | pgvector for vector(512) + HNSW/IVFFlat | GO |
| 2 | Zero `rachandzach_%` / `rachandzach-%` name collisions | GO |
| 3 | Migration history compatibility | GO, follow versioning rule |
| 4 | Storage limits for 50MB guest uploads | GO for migrations, checklist item for uploads |
| 5 | Auth / magic-link readiness | GO for migrations, checklist item for SMTP |
| 6 | Vercel account shape | GO, new project needed at deploy gate |

## 1. pgvector: GO

- `pg_available_extensions` reports `vector` at version **0.8.0**, `installed_version` is **null** (available, not yet installed).
- Server version confirmed live as **17.6**. pgvector 0.8.0 is the current Supabase build for PG17 and its comment string advertises "ivfflat and hnsw access methods".
- `vector(512)` is well inside pgvector's index limits (HNSW and IVFFlat both index up to 2,000 dimensions). CLIP 512-dim embeddings with HNSW cosine ops are fully supported.
- The migration must run `create extension if not exists vector with schema extensions;`. This is the only project-global side effect our migrations introduce; it is additive and cannot disturb the other tenants (none of the 213 existing public tables use vector today).

## 2. Name safety: GO (zero collisions)

A single sweep across `pg_tables`, `pg_views`, `pg_matviews`, `pg_proc`, `pg_indexes`, `pg_policies`, `information_schema.sequences`, `pg_namespace`, `pg_type`, `pg_trigger`, `pg_publication`, `pg_roles`, and `storage.buckets` for `rachandzach%` returned **zero rows** in every category.

Context on the neighborhood we are moving into:

- 213 tables in `public`, database size 531 MB. Other schemas present: `_archive_`, `ops`, `private`, plus the standard Supabase set. Nothing wedding-related exists yet.
- Existing buckets, all 4 of them: `Clips` (private), `nba-props-artifacts` (private), `wc-event-files` (private, 10 MB cap, MIME allowlist), `ugc-thumbs` (public). None collide with the five planned `rachandzach-*` buckets.

The `rachandzach_` table prefix and `rachandzach-` bucket prefix are clean namespaces. Keep every object we create (tables, indexes, functions, policies, triggers, types) under that prefix so this sweep stays repeatable.

## 3. Migration history: GO, with a versioning rule

- Tracking lives in `supabase_migrations.schema_migrations` (the standard CLI/MCP table; it is the only table in that schema). Columns: `version, statements, name, hash, executed_at, created_by, idempotency_key, rollback`.
- **249 migrations** recorded. Latest version: **`20260722040000`** (`leaguel_email_delivery_service_role_grants`, applied earlier today).
- The MCP `apply_migration` tool inserts into this same table, so our migrations will interleave cleanly with the existing history. Nothing else to set up.

Apply-time rules:

1. Version every migration with a real current timestamp strictly greater than `20260722040000` (any `20260722HHMMSS` after 04:00:00 UTC today qualifies; use the actual apply time).
2. Name every migration with the `rachandzach_` prefix (e.g. `rachandzach_core_schema`) so it is greppable in the shared history the same way the `leaguel_*` and `nba_props_*` families are.
3. Never edit, reorder, or repair existing rows in `schema_migrations`. Append only.

## 4. Storage: GO for migrations, one checklist item for uploads

- Per-bucket `file_size_limit` and `allowed_mime_types` are in active use here (convention: `wc-event-files` caps at 10,485,760 bytes with a document/image MIME allowlist; the other three buckets leave both null and inherit the project-global cap). Our buckets should follow the explicit-cap convention: 52,428,800 (50 MB) plus a JPEG/PNG/WebP/HEIC allowlist on `rachandzach-guest-pending`, and appropriate caps on the others.
- 2,209 objects exist in storage today. No naming or path conflicts possible with the `rachandzach-*` prefix.
- **Checklist item, not a migration blocker:** the project-global upload size limit is service config, not stored in Postgres, so it cannot be confirmed read-only via SQL. A bucket-level 50 MB limit is silently overridden by a smaller global cap. Before the first guest upload test (and before syncing any original larger than the cap), confirm in Dashboard > Storage > Settings that the global file size limit is at least 50 MB. On paid plans it is adjustable; on Free it is fixed at 50 MB, which would exactly cover the 50 MB guest ceiling but must be verified.
- Bucket creation itself is a separate gated write and is not part of the SQL migration apply.

## 5. Auth: GO for migrations, SMTP is a launch-checklist item

Visible read-only via the `auth` schema:

- 6 users total: 4 with `email` identities, 2 anonymous. Anonymous sign-ins have therefore been enabled on this project at some point, which is compatible with (but not required by) our shared guest-session model.
- **Zero users** matching `%rachandzach%`, so the admin identity for wedding@rachandzach.com does not exist yet and will be created by the first magic-link sign-in.
- No SSO/SAML providers configured. Standard GoTrue table set present (mfa, oauth, webauthn tables all idle).

Implications:

- **Shared user pool:** `auth.users` is shared with the other apps on this project. All wedding RLS policies and admin checks must scope to the specific admin identity (email or user id), never to "any authenticated user". The plan's fail-closed rule already covers this; recording it here because the pool is confirmed non-empty.
- **Launch-checklist item (flag, not fix):** SMTP configuration lives in GoTrue service config, not the database, so it cannot be verified read-only from SQL. Supabase's built-in email service is heavily rate-limited and restricted, and is not suitable for production magic links. Before launch, confirm custom SMTP is configured in Dashboard > Auth > SMTP (Resend SMTP is the natural fit since Resend is already in the stack), and that the magic-link email template and redirect URL allowlist include the production domain. Until then, magic-link delivery to wedding@rachandzach.com should be treated as unverified.
- None of this affects the migration apply. Our migrations only reference `auth.uid()` / `auth.jwt()` in policies, which requires no auth config.

## 6. Vercel: GO, new project needed at the deploy gate

- One team: **`zach soskin's projects`** (`team_nIgo3KgkMeSSimHIRyzAvXAa`, slug `zach-soskins-projects-95c2533d`). No SAML restrictions.
- 33 projects exist. **No project for this site**: nothing named rachandzach, wedding, gallery, or similar. The deploy gate will be a net-new project creation, not an update of an existing one.
- The account already runs several Supabase-backed Next.js apps against this same PrizmLounge project (`prizm-lounge-ugc`, `sbprizmlounge`, `the-leaguel`, `value-hunter-survivor-pool`), so the deployment pattern is proven on this account.
- Reminder from the plan: no deploy of any kind (including preview) without Zach's explicit approval. This section is shape recon only.

## Queries used (all read-only)

- `list_extensions`, `list_migrations` (Supabase MCP)
- `pg_available_extensions` + `current_setting('server_version')`
- Collision sweep over pg_catalog, information_schema, and `storage.buckets` for `rachandzach%`
- `supabase_migrations.schema_migrations` shape and max version
- `storage.buckets` full listing; `storage.objects` count
- `auth.users` / `auth.identities` / `auth.sso_providers` aggregates (counts only, no PII pulled)
- Vercel MCP `list_teams`, `list_projects`
