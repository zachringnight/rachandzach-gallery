/**
 * Schema and storage-rule tests for packet 03.
 *
 * Two layers:
 *
 * 1. Static layer (always runs): parses supabase/config.toml and the migration
 *    SQL for the non-negotiables -- private buckets, default-deny policies,
 *    unique + check constraints, the rachandzach_gallery_events allowlisted-key check,
 *    the file_sha256 index, and the rate-limit function contract.
 *
 * 2. Live layer (runs only against a local Supabase stack): asserts real RLS
 *    denial for anonymous writes, cascade behavior, unique violations, the
 *    rachandzach_gallery_events metadata check, and rachandzach_consume_rate_limit semantics.
 *    Enable it by exporting the values printed by `supabase status` after
 *    `supabase start`:
 *      SUPABASE_URL, SUPABASE_ANON_KEY, and (for the service suite)
 *      SUPABASE_SERVICE_ROLE_KEY. SUPABASE_DB_URL alone is not enough because
 *      this repo intentionally ships no raw Postgres driver.
 *    Without those, the live layer skips loudly instead of passing silently.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import {
  GALLERY_EVENT_METADATA_KEYS,
  GALLERY_EVENT_NAMES,
  GUEST_UPLOAD_ALLOWED_MIME_TYPES,
  GUEST_UPLOAD_MAX_BYTES,
  STORAGE_BUCKETS,
} from "@/lib/supabase/schema";
import type { Database } from "@/lib/supabase/database.types";

const repoRoot = path.resolve(__dirname, "..", "..");
const supabaseDir = path.join(repoRoot, "supabase");
const coreMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "202607220001_gallery_core.sql",
);
const storageMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "202607220002_storage_policies.sql",
);
const rateLimitFixMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "202607220004_rate_limit_conflict_fix.sql",
);
const guestFavoritesMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "202607220005_guest_favorites.sql",
);
const photoMemoriesMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "202607220006_photo_memories.sql",
);
const approvedUploadCaptionsMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "20260724123508_rachandzach_approved_upload_captions.sql",
);
const photoProcessingGateMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "20260724124851_rachandzach_photo_processing_gate.sql",
);
const removeAddedPersonMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "20260726213000_rachandzach_remove_added_person.sql",
);
const addPersonMigrationPath = path.join(
  supabaseDir,
  "migrations",
  "20260726233000_rachandzach_add_person.sql",
);
const configPath = path.join(supabaseDir, "config.toml");
const seedPath = path.join(supabaseDir, "seed.sql");
const envExamplePath = path.join(repoRoot, ".env.example");
const databaseTypesPath = path.join(
  repoRoot,
  "src",
  "lib",
  "supabase",
  "database.types.ts",
);

function mustRead(filePath: string): string {
  expect(
    existsSync(filePath),
    `expected file to exist: ${filePath}`,
  ).toBe(true);
  return readFileSync(filePath, "utf8");
}

/**
 * Remove `-- ...` line comments so prohibition checks match only real SQL
 * statements, not warning comments that quote the forbidden pattern.
 */
function stripSqlComments(sqlText: string): string {
  return sqlText.replace(/--[^\n]*/g, "");
}

/** Extract the body of `create table public.<name> ( ... );`. */
function tableDef(sql: string, tableName: string): string {
  const marker = `create table public.${tableName} (`;
  const start = sql.indexOf(marker);
  expect(start, `missing "${marker}" in core migration`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n);", start);
  expect(end, `unterminated table def for ${tableName}`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const ALL_TABLES = [
  "rachandzach_events",
  "rachandzach_people",
  "rachandzach_photos",
  "rachandzach_photo_people",
  "rachandzach_photo_keywords",
  "rachandzach_photo_previews",
  "rachandzach_upload_batches",
  "rachandzach_upload_items",
  "rachandzach_moderation_actions",
  "rachandzach_notification_log",
  "rachandzach_rate_limit_buckets",
  "rachandzach_gallery_events",
] as const;

const PRIVATE_BUCKETS = Object.values(STORAGE_BUCKETS);

describe("static: supabase files exist", () => {
  it("has config, both migrations, and a seed file", () => {
    for (const p of [configPath, coreMigrationPath, storageMigrationPath, seedPath]) {
      expect(existsSync(p), `expected file to exist: ${p}`).toBe(true);
    }
  });
});

describe("static: approved uploader captions migration", () => {
  const sql = () => mustRead(approvedUploadCaptionsMigrationPath);

  it("persists the per-item decision and bounds catalog caption fields", () => {
    const text = sql();
    expect(text).toContain(
      "add column note_approved boolean not null default false",
    );
    expect(text).toContain("add column uploader_caption text");
    expect(text).toContain(
      "char_length(uploader_caption) between 1 and 2000",
    );
    expect(text).toContain("add column uploader_caption_byline text");
    expect(text).toContain(
      "char_length(uploader_caption_byline) between 1 and 120",
    );
    expect(text).toContain(
      "rachandzach_photos_caption_byline_requires_caption",
    );
    expect(text).not.toMatch(/\bemail\b\s+(text|varchar)/i);
  });
});

describe("static: guest photo processing gate migration", () => {
  const sql = () => mustRead(photoProcessingGateMigrationPath);

  it("defaults existing photos to complete without changing access grants", () => {
    const text = sql();
    expect(text).toContain(
      "add column processing_complete boolean not null default true",
    );
    expect(text).toContain("gallery publication requires all preview");
    expect(stripSqlComments(text)).not.toMatch(/\b(grant|revoke)\b/i);
  });
});

describe("static: core migration", () => {
  const sql = () => mustRead(coreMigrationPath);

  it("creates every catalog, upload, moderation, and audit table", () => {
    const text = sql();
    for (const table of ALL_TABLES) {
      expect(text).toContain(`create table public.${table} (`);
    }
  });

  it("enables row level security on every table with no permissive policies (default deny)", () => {
    const text = sql();
    for (const table of ALL_TABLES) {
      expect(text).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
    // Default deny: the core migration must not create any policy at all.
    expect(text).not.toMatch(/create\s+policy/i);
  });

  it("revokes table privileges per object, never schema-wide (shared project)", () => {
    const text = sql();
    for (const table of ALL_TABLES) {
      expect(text).toContain(
        `revoke all on table public.${table} from public, anon, authenticated;`,
      );
      expect(text).toContain(`grant all on table public.${table} to service_role;`);
    }
    // Schema-wide statements would strip grants from other tenants' objects
    // on the shared PrizmLounge project. They must never appear as SQL
    // (comments may quote them as warnings, so match on stripped text).
    const statements = stripSqlComments(text);
    expect(statements).not.toMatch(/on\s+all\s+tables\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+functions\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+sequences\s+in\s+schema/i);
    expect(statements).not.toMatch(/alter\s+default\s+privileges/i);
    expect(statements).not.toMatch(/create\s+event\s+trigger/i);
    expect(statements).not.toMatch(/create\s+publication/i);
  });

  it("pins search_path on every rachandzach_ function", () => {
    const text = sql();
    for (const fn of [
      "rachandzach_set_updated_at",
      "rachandzach_bump_person_photo_count",
      "rachandzach_gallery_event_metadata_is_allowed",
      "rachandzach_consume_rate_limit",
    ]) {
      const start = text.indexOf(`create or replace function public.${fn}(`);
      expect(start, `missing definition for ${fn}`).toBeGreaterThan(-1);
      const header = text.slice(start, text.indexOf("$$", start));
      expect(header, `${fn} must pin search_path`).toContain("set search_path");
    }
  });

  it("enforces the required unique constraints", () => {
    const text = sql();
    expect(tableDef(text, "rachandzach_events")).toContain("slug text not null unique");
    expect(tableDef(text, "rachandzach_people")).toContain("slug text not null unique");
    expect(tableDef(text, "rachandzach_photos")).toContain(
      "image_data_hash text not null unique",
    );
    expect(tableDef(text, "rachandzach_upload_batches")).toContain(
      "receipt_hash text not null unique",
    );
    expect(tableDef(text, "rachandzach_upload_items")).toContain(
      "object_path text not null unique",
    );
    expect(tableDef(text, "rachandzach_notification_log")).toContain(
      "idempotency_key text not null unique",
    );
    expect(tableDef(text, "rachandzach_photo_previews")).toContain(
      "object_path text not null unique",
    );
  });

  it("enforces composite primary keys", () => {
    const text = sql();
    expect(tableDef(text, "rachandzach_photo_people")).toContain(
      "primary key (photo_id, person_id)",
    );
    expect(tableDef(text, "rachandzach_photo_keywords")).toContain(
      "primary key (photo_id, keyword)",
    );
    expect(tableDef(text, "rachandzach_photo_previews")).toContain(
      "primary key (photo_id, width, format)",
    );
    expect(tableDef(text, "rachandzach_rate_limit_buckets")).toContain(
      "primary key (key_hash, action, window_start)",
    );
  });

  it("enforces enum-style check constraints", () => {
    const text = sql();
    const rachandzach_photos = tableDef(text, "rachandzach_photos");
    expect(rachandzach_photos).toContain("check (source in ('master', 'guest'))");
    expect(rachandzach_photos).toContain(
      "check (status in ('published', 'hidden', 'pending', 'rejected'))",
    );
    expect(rachandzach_photos).toContain("check (file_sha256 ~ '^[0-9a-f]{64}$')");
    expect(rachandzach_photos).toContain("check (image_data_hash ~ '^[0-9a-f]{32,64}$')");

    const items = tableDef(text, "rachandzach_upload_items");
    expect(items).toContain(
      "check (media_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic'))",
    );
    expect(items).toContain(`check (bytes > 0 and bytes <= ${GUEST_UPLOAD_MAX_BYTES})`);
  });

  it("requires content-hash naming for source objects", () => {
    const rachandzach_photos = tableDef(sql(), "rachandzach_photos");
    expect(rachandzach_photos).toContain("rachandzach_photos_original_object_content_hash");
    expect(rachandzach_photos).toContain("position(substr(file_sha256, 1, 16) in original_object) > 0");
  });

  it("indexes file_sha256 for guest duplicate lookups, plus paging and queue indexes", () => {
    const text = sql();
    expect(text).toContain(
      "create index rachandzach_photos_file_sha256_idx on public.rachandzach_photos (file_sha256);",
    );
    expect(text).toMatch(
      /create index .* on public\.rachandzach_gallery_events \(photo_id\)/,
    );
    expect(text).toMatch(/create index .* on public\.rachandzach_photos \(event_id, captured_at/);
    expect(text).toMatch(/create index .* on public\.rachandzach_photos \(status\)/);
    expect(text).toMatch(/create index .* on public\.rachandzach_photos \(source\)/);
    expect(text).toMatch(/create index .* on public\.rachandzach_photo_people \(person_id\)/);
    expect(text).toMatch(/create index .* on public\.rachandzach_upload_items \(status, batch_id\)/);
    expect(text).toMatch(/create index .* on public\.rachandzach_upload_batches \(status, submitted_at/);
  });

  it("constrains rachandzach_gallery_events to an allowlisted, non-identifying shape", () => {
    const text = sql();
    const galleryEvents = tableDef(text, "rachandzach_gallery_events");
    expect(galleryEvents).toContain(
      "check (public.rachandzach_gallery_event_metadata_is_allowed(metadata))",
    );
    expect(galleryEvents).toContain("check (event_name in (");
    for (const name of GALLERY_EVENT_NAMES) {
      expect(galleryEvents).toContain(`'${name}'`);
    }

    // Extract the metadata key allowlist from the guard function and compare
    // it, exactly, to the constant the application layer imports.
    const fnStart = text.indexOf("rachandzach_gallery_event_metadata_is_allowed");
    expect(fnStart).toBeGreaterThan(-1);
    const arrayMatch = text.slice(fnStart).match(/array\[([^\]]+)\]/);
    expect(arrayMatch, "metadata allowlist array literal not found").toBeTruthy();
    const sqlKeys = arrayMatch![1]
      .split(",")
      .map((k) => k.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(sqlKeys).toEqual([...GALLERY_EVENT_METADATA_KEYS].sort());

    // No field for names, emails, raw URLs, or search text to live in.
    for (const forbidden of ["email", "name", "url", "query", "search", "session_id", "ip"]) {
      expect(sqlKeys).not.toContain(forbidden);
    }
    // Scalar-only and string-content guards inside the function.
    expect(text).toContain("jsonb_typeof(kv.value) in ('object', 'array')");
    expect(text).toMatch(/char_length\(kv\.value #>> '\{\}'\) > \d+/);
  });

  it("defines rachandzach_consume_rate_limit with the packet signature, locked to service_role", () => {
    const text = sql();
    expect(text).toMatch(
      /create or replace function public\.rachandzach_consume_rate_limit\(\s*key_hash text,\s*action text,\s*attempt_limit int,\s*window_seconds int\s*\)\s*returns boolean/,
    );
    expect(text).toMatch(/security definer/);
    expect(text).toMatch(
      /revoke all on function public\.rachandzach_consume_rate_limit\(text, text, int, int\) from public, anon, authenticated;/,
    );
    expect(text).toMatch(
      /grant execute on function public\.rachandzach_consume_rate_limit\(text, text, int, int\) to service_role;/,
    );
  });

  it("handles updated_at deterministically via prefixed trigger helpers", () => {
    const text = sql();
    expect(text).toContain(
      "create or replace function public.rachandzach_set_updated_at()",
    );
    for (const table of ["rachandzach_events", "rachandzach_people", "rachandzach_photos", "rachandzach_upload_batches", "rachandzach_upload_items"]) {
      expect(text).toMatch(
        new RegExp(
          `create trigger ${table}_set_updated_at\\s+before update on public\\.${table}\\s+for each row execute function public\\.rachandzach_set_updated_at\\(\\)`,
        ),
      );
    }
    expect(text).toContain(
      "create or replace function public.rachandzach_bump_person_photo_count()",
    );
    expect(text).toMatch(
      /create trigger rachandzach_photo_people_bump_photo_count\s+after insert or delete on public\.rachandzach_photo_people\s+for each row execute function public\.rachandzach_bump_person_photo_count\(\)/,
    );
    // Unprefixed helper names could collide with (or be replaced by) another
    // tenant's functions on the shared project. They must never appear.
    expect(text).not.toMatch(/public\.set_updated_at\(/);
    expect(text).not.toMatch(/public\.bump_person_photo_count\(/);
    expect(text).not.toMatch(/public\.gallery_event_metadata_is_allowed\(/);
  });
});

describe("static: rate-limit conflict fix migration (202607220004)", () => {
  // The core migration's rachandzach_consume_rate_limit has an ambiguous
  // ON CONFLICT column list (SQLSTATE 42702 against a real Postgres; the
  // conflict-target columns collide with the same-named function
  // parameters). Migration 0004 replaces the function targeting the primary
  // key CONSTRAINT by name, which sidesteps column inference entirely. The
  // fix is already applied and smoke-tested against the cloud project; this
  // test pins the local migration chain so `supabase db reset` ends up with
  // the working definition too.
  it("exists and replaces the function with a constraint-named conflict target", () => {
    const sql = stripSqlComments(mustRead(rateLimitFixMigrationPath));
    expect(sql).toContain(
      "create or replace function public.rachandzach_consume_rate_limit",
    );
    expect(sql).toContain(
      "on conflict on constraint rachandzach_rate_limit_buckets_pkey",
    );
    // The corrective migration must sort after the core migration so its
    // definition wins on a fresh local apply.
    expect(
      path.basename(rateLimitFixMigrationPath) >
        path.basename(coreMigrationPath),
    ).toBe(true);
    // Privilege hygiene mirrors the shared-project convention.
    expect(sql).toContain(
      "revoke all on function public.rachandzach_consume_rate_limit",
    );
    expect(sql).toContain("grant execute on function public.rachandzach_consume_rate_limit");
  });
});

describe("static: guest favorites migration (202607220005)", () => {
  // Favorites v2: server persistence for the local-first FavoriteStore. Rows
  // key photo ids to an anonymous session id or a self-claimed person slug;
  // the shared-project convention (per-object revokes, RLS on, zero
  // policies, service_role only) applies to this migration exactly as it
  // does to the core one.
  const sql = () => mustRead(guestFavoritesMigrationPath);

  it("creates the table with the owner-kind check, cascade FK, and composite PK", () => {
    const table = tableDef(sql(), "rachandzach_guest_favorites");
    expect(table).toContain("check (owner_kind in ('session', 'person'))");
    expect(table).toContain("owner_key text not null");
    expect(table).toContain(
      "photo_id uuid not null references public.rachandzach_photos (id) on delete cascade",
    );
    expect(table).toContain("created_at timestamptz not null default now()");
    expect(table).toContain("primary key (owner_kind, owner_key, photo_id)");
  });

  it("indexes the owner key for list-my-favorites reads", () => {
    expect(sql()).toMatch(
      /create index rachandzach_guest_favorites_owner_idx\s+on public\.rachandzach_guest_favorites \(owner_kind, owner_key\);/,
    );
  });

  it("stays default deny: RLS on, zero policies, per-object grants only", () => {
    const text = sql();
    expect(text).toContain(
      "alter table public.rachandzach_guest_favorites enable row level security;",
    );
    expect(text).toContain(
      "revoke all on table public.rachandzach_guest_favorites from public, anon, authenticated;",
    );
    expect(text).toContain(
      "grant all on table public.rachandzach_guest_favorites to service_role;",
    );
    const statements = stripSqlComments(text);
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/on\s+all\s+tables\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+functions\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+sequences\s+in\s+schema/i);
    expect(statements).not.toMatch(/alter\s+default\s+privileges/i);
    expect(statements).not.toMatch(/create\s+event\s+trigger/i);
    expect(statements).not.toMatch(/create\s+publication/i);
    // No functions are created, so nothing here needs a pinned search_path;
    // assert that stays true (a future function would need one).
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
  });

  it("sorts after the core migration and is mirrored in database.types.ts", () => {
    expect(
      path.basename(guestFavoritesMigrationPath) >
        path.basename(coreMigrationPath),
    ).toBe(true);
    const types = mustRead(databaseTypesPath);
    expect(types).toMatch(/\brachandzach_guest_favorites: \{/);
  });
});

describe("static: photo memories migration (202607220006)", () => {
  // Memories wall (Round Two): guest notes attached to specific photos,
  // pending until approved. Same owner model as guest favorites, same
  // shared-project convention (per-object revokes, RLS on, zero policies,
  // service_role only). The generated database.types.ts mirror lands with
  // the next `npm run types:generate` (Integrate step), so unlike the
  // favorites block there is no types assertion here yet; the server layer
  // reaches the table through the structural client in
  // src/lib/memories/server.ts until then.
  const sql = () => mustRead(photoMemoriesMigrationPath);

  it("creates the table with owner, moderation, and length constraints", () => {
    const table = tableDef(sql(), "rachandzach_photo_memories");
    expect(table).toContain("id uuid primary key default gen_random_uuid()");
    expect(table).toContain(
      "photo_id uuid not null references public.rachandzach_photos (id) on delete cascade",
    );
    expect(table).toContain("check (owner_kind in ('session', 'person'))");
    expect(table).toContain(
      "owner_key text not null check (char_length(owner_key) between 1 and 120)",
    );
    expect(table).toContain(
      "check (display_name is null or char_length(display_name) between 1 and 80)",
    );
    expect(table).toContain(
      "body text not null check (char_length(body) between 1 and 500)",
    );
    expect(table).toContain(
      "check (status in ('pending', 'approved', 'rejected'))",
    );
    expect(table).toContain("status text not null default 'pending'");
    expect(table).toContain("created_at timestamptz not null default now()");
    expect(table).toContain("reviewed_at timestamptz");
  });

  it("indexes the guest read path (photo_id, status) and the review queue (status)", () => {
    const text = sql();
    expect(text).toMatch(
      /create index rachandzach_photo_memories_photo_status_idx\s+on public\.rachandzach_photo_memories \(photo_id, status\);/,
    );
    expect(text).toMatch(
      /create index rachandzach_photo_memories_status_idx\s+on public\.rachandzach_photo_memories \(status\);/,
    );
  });

  it("stays default deny: RLS on, zero policies, per-object grants only", () => {
    const text = sql();
    expect(text).toContain(
      "alter table public.rachandzach_photo_memories enable row level security;",
    );
    expect(text).toContain(
      "revoke all on table public.rachandzach_photo_memories from public, anon, authenticated;",
    );
    expect(text).toContain(
      "grant all on table public.rachandzach_photo_memories to service_role;",
    );
    const statements = stripSqlComments(text);
    expect(statements).not.toMatch(/create\s+policy/i);
    expect(statements).not.toMatch(/on\s+all\s+tables\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+functions\s+in\s+schema/i);
    expect(statements).not.toMatch(/on\s+all\s+sequences\s+in\s+schema/i);
    expect(statements).not.toMatch(/alter\s+default\s+privileges/i);
    expect(statements).not.toMatch(/create\s+event\s+trigger/i);
    expect(statements).not.toMatch(/create\s+publication/i);
    // No functions are created, so nothing here needs a pinned search_path;
    // assert that stays true (a future function would need one).
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
  });

  it("sorts after the core and favorites migrations", () => {
    expect(
      path.basename(photoMemoriesMigrationPath) >
        path.basename(coreMigrationPath),
    ).toBe(true);
    expect(
      path.basename(photoMemoriesMigrationPath) >
        path.basename(guestFavoritesMigrationPath),
    ).toBe(true);
  });
});

describe("static: storage migration", () => {
  const sql = () => mustRead(storageMigrationPath);

  it("declares all five buckets as private", () => {
    const text = sql();
    for (const bucket of PRIVATE_BUCKETS) {
      expect(text).toContain(`('${bucket}', '${bucket}', false`);
    }
    // No bucket row may be public.
    expect(text).not.toMatch(/,\s*true\s*,/);
  });

  it("limits rachandzach-guest-pending to allowed image types and 50 MB at the bucket level", () => {
    const text = sql();
    const insertStart = text.indexOf("insert into storage.buckets");
    const insertEnd = text.indexOf("on conflict", insertStart);
    expect(insertStart).toBeGreaterThan(-1);
    expect(insertEnd).toBeGreaterThan(insertStart);
    const insert = text.slice(insertStart, insertEnd);
    const pendingRow = insert
      .split("\n")
      .filter((line) => line.includes(`'${STORAGE_BUCKETS.guestPending}'`))
      .join("\n");
    expect(pendingRow).toContain(String(GUEST_UPLOAD_MAX_BYTES));
    for (const mime of GUEST_UPLOAD_ALLOWED_MIME_TYPES) {
      expect(pendingRow).toContain(`'${mime}'`);
    }
  });

  it("keeps storage.objects default deny: RLS on, no guest-facing policies", () => {
    const text = sql();
    expect(text).toContain(
      "alter table storage.objects enable row level security",
    );
    // Either zero policies, or none granted to anon/authenticated/public.
    const policies = text.match(/create policy[\s\S]*?;/gi) ?? [];
    for (const policy of policies) {
      expect(policy).not.toMatch(/to\s+(anon|authenticated|public)\b/i);
    }
  });

  it("prevents source-object overwrites by trigger policy", () => {
    const text = sql();
    expect(text).toContain("public.rachandzach_prevent_immutable_object_overwrite");
    expect(text).toContain("rachandzach_storage_objects_prevent_overwrite");
    expect(text).toContain(`'${STORAGE_BUCKETS.originals}'`);
    expect(text).toContain(`'${STORAGE_BUCKETS.previews}'`);
    expect(text).toMatch(/before update on storage\.objects/);
    expect(text).toMatch(/new\.version is distinct from old\.version/);
    // The storage service finalizes uploads with its own UPDATE on the row;
    // only already-finalized objects (metadata set) may be locked, or the
    // first upload into an immutable bucket could never complete.
    expect(text).toMatch(/old\.metadata is not null/);
  });

  it("scopes the storage.objects trigger to this project's buckets only", () => {
    const text = sql();
    // Any "drop trigger if exists" on the shared storage.objects table must
    // target only our prefixed trigger name, never a generic name another
    // tenant might own.
    for (const dropStmt of text.match(/drop trigger if exists\s+\S+/gi) ?? []) {
      expect(dropStmt).toMatch(/drop trigger if exists\s+rachandzach_/i);
    }
    // The trigger function must no-op for any object outside the five
    // rachandzach- buckets so other tenants' storage behavior is untouched.
    const guard = text.match(/old\.bucket_id not in \(([^)]+)\)/);
    expect(guard, "tenant no-op guard not found in trigger function").toBeTruthy();
    for (const bucket of PRIVATE_BUCKETS) {
      expect(guard![1]).toContain(`'${bucket}'`);
    }
    // The trigger itself only fires for our buckets via a WHEN clause.
    expect(text).toMatch(/when \(old\.bucket_id in \(/);
    // No storage policy may exist without a bucket_id scope to one of our
    // five buckets (today the file intentionally creates zero policies).
    // Match against comment-stripped text so prose mentioning CREATE POLICY
    // is not mistaken for a statement.
    const statements = stripSqlComments(text);
    const policies = statements.match(/create policy[\s\S]*?;/gi) ?? [];
    for (const policy of policies) {
      expect(policy).toMatch(/bucket_id/);
      expect(policy).toMatch(/rachandzach-/);
    }
  });
});

describe("static: config.toml declares private local buckets", () => {
  it("declares each bucket private, with rachandzach-guest-pending MIME and size caps", () => {
    const config = mustRead(configPath);
    for (const bucket of PRIVATE_BUCKETS) {
      expect(config).toContain(`[storage.buckets.${bucket}]`);
    }
    expect(config).not.toContain("public = true");
    const pendingStart = config.indexOf(
      `[storage.buckets.${STORAGE_BUCKETS.guestPending}]`,
    );
    const pendingBlock = config.slice(pendingStart, pendingStart + 400);
    expect(pendingBlock).toContain('file_size_limit = "50MiB"');
    for (const mime of GUEST_UPLOAD_ALLOWED_MIME_TYPES) {
      expect(pendingBlock).toContain(`"${mime}"`);
    }
  });
});

describe("static: no secrets in committed files", () => {
  it(".env.example holds placeholders only", () => {
    const env = mustRead(envExamplePath);
    expect(env).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // no JWTs
    expect(env).not.toMatch(/sb_secret_[A-Za-z0-9]/); // no new-format secret keys
    expect(env).toMatch(/SUPABASE_SERVICE_ROLE_KEY=paste-/); // placeholder, not a key
    expect(env).not.toContain("071925"); // legacy shared password must not ship
  });

  it("seed.sql is synthetic only", () => {
    const seed = mustRead(seedPath);
    expect(seed).not.toMatch(/@(?!example\.invalid)[a-z0-9.-]+\.(com|net|org)/i);
    expect(seed).toMatch(/sample/i);
  });
});

describe("static: remove-added-person migration (20260726213000)", () => {
  const sql = () => mustRead(removeAddedPersonMigrationPath);

  it("makes the reference checks and the delete one atomic statement set", () => {
    const text = sql();
    expect(text).toContain(
      "create function public.rachandzach_remove_added_person(p_slug text)",
    );
    // The serialization point that closes the tag race: the catalog row is
    // locked before any check, so a concurrent rachandzach_photo_people
    // insert (FOR KEY SHARE via its person_id FK) cannot interleave between
    // check and delete.
    expect(text).toMatch(/from public\.rachandzach_people\s+where slug = p_slug\s+for update/);
    // Both durable reference kinds gate the delete: photo tags and
    // person-keyed guest favorites (a guest's shortlist).
    expect(text).toContain("from public.rachandzach_photo_people");
    expect(text).toMatch(/rachandzach_guest_favorites[\s\S]*owner_kind = 'person'/);
    // Photographs are never named as a delete target.
    expect(stripSqlComments(text)).not.toMatch(
      /delete\s+from\s+public\.rachandzach_photos\b/i,
    );
    expect(text).toContain("set search_path = ''");
  });

  it("keeps the function service-role only", () => {
    const text = sql();
    expect(text).toContain(
      "revoke all on function public.rachandzach_remove_added_person(text) from public, anon, authenticated;",
    );
    expect(text).toContain(
      "grant execute on function public.rachandzach_remove_added_person(text) to service_role;",
    );
  });
});

describe("static: add-person migration (20260726233000)", () => {
  const sql = () => mustRead(addPersonMigrationPath);

  it("creates both rows in one function so no half-created person is ever visible", () => {
    const text = sql();
    expect(text).toContain("create function public.rachandzach_add_person(");
    // Both inserts live inside the single transaction the function body is.
    expect(text).toMatch(/insert into public\.rachandzach_people\s*\(slug, display_name\)/);
    expect(text).toMatch(
      /insert into public\.rachandzach_person_overrides\s*\(person_slug, display_name, added, updated_by\)/,
    );
    // A duplicate rolls BOTH inserts back via the exception subtransaction.
    expect(text).toMatch(/exception when unique_violation then/);
    // The whole point of the migration: the add path contains no delete of
    // any kind, so there is no compensating statement left to cascade into
    // rachandzach_photo_people. photo_count stays trigger-owned.
    expect(stripSqlComments(text)).not.toMatch(/\bdelete\b/i);
    expect(stripSqlComments(text)).not.toMatch(/photo_count/);
    expect(text).toContain("set search_path = ''");
  });

  it("keeps the function service-role only", () => {
    const text = sql();
    expect(text).toContain(
      "revoke all on function public.rachandzach_add_person(text, text, text) from public, anon, authenticated;",
    );
    expect(text).toContain(
      "grant execute on function public.rachandzach_add_person(text, text, text) to service_role;",
    );
  });
});

describe("static: database.types.ts mirrors the migrations", () => {
  it("declares every table and the rachandzach functions", () => {
    const types = mustRead(databaseTypesPath);
    for (const table of ALL_TABLES) {
      expect(types).toMatch(new RegExp(`\\b${table}: \\{`));
    }
    expect(types).toContain("rachandzach_consume_rate_limit");
    expect(types).toContain("rachandzach_remove_added_person");
    expect(types).toContain("rachandzach_add_person");
    expect(types).toContain("npm run types:generate");
  });
});

// ---------------------------------------------------------------------------
// Live layer -- requires a running local Supabase stack.
// ---------------------------------------------------------------------------

const liveUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const liveAnonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const liveServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const anonReady = Boolean(liveUrl && liveAnonKey);
const serviceReady = Boolean(liveUrl && liveServiceKey);

if (!anonReady) {
  // process.stderr.write instead of console.warn: vitest's default reporter
  // swallows module-scope console output, and this skip must be loud.
  process.stderr.write(
    [
      "",
      "==========================================================================",
      "  SCHEMA TEST: LIVE DATABASE SUITE SKIPPED",
      "  No local Supabase stack detected (SUPABASE_URL / SUPABASE_ANON_KEY not",
      "  set; SUPABASE_DB_URL alone is not usable because no Postgres driver is",
      "  installed). Static SQL assertions still ran.",
      "  To run the full suite once Docker is available:",
      "    supabase start && supabase db reset",
      "    export SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=...",
      "    npm run test -- tests/database/schema.test.ts",
      "==========================================================================",
      "",
    ].join("\n"),
  );
}

describe.skipIf(!anonReady)("live: anonymous access is denied everywhere", () => {
  const anon = () => createClient<Database>(liveUrl!, liveAnonKey!);

  it("denies anonymous inserts into catalog tables", async () => {
    const { error } = await anon().from("rachandzach_events").insert({
      slug: "anon-should-fail",
      name: "Anon Should Fail",
    });
    expect(error).toBeTruthy();
  });

  it("denies anonymous inserts into rachandzach_photos", async () => {
    const { error } = await anon().from("rachandzach_photos").insert({
      image_data_hash: "0123456789abcdef0123456789abcdef",
      file_sha256: "a".repeat(64),
      original_bucket: STORAGE_BUCKETS.originals,
      original_object: `rachandzach_photos/${"a".repeat(16)}-anon.jpg`,
      original_filename: "anon.jpg",
      original_bytes: 1,
      source: "master",
      status: "published",
    });
    expect(error).toBeTruthy();
  });

  it("denies anonymous inserts into moderation and notification tables", async () => {
    const modInsert = await anon().from("rachandzach_moderation_actions").insert({
      actor_user_id: "00000000-0000-4000-8000-000000000000",
      action: "approve_item",
    });
    expect(modInsert.error).toBeTruthy();
    const noteInsert = await anon().from("rachandzach_notification_log").insert({
      batch_id: "00000000-0000-4000-8000-000000000000",
      kind: "guest_receipt",
      idempotency_key: "anon-should-fail",
      status: "queued",
    });
    expect(noteInsert.error).toBeTruthy();
  });

  it("denies anonymous reads of the review pipeline", async () => {
    const { data, error } = await anon().from("rachandzach_upload_items").select("id");
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });

  it("denies anonymous rachandzach_consume_rate_limit calls", async () => {
    const { error } = await anon().rpc("rachandzach_consume_rate_limit", {
      key_hash: "a".repeat(64),
      action: "test",
      attempt_limit: 5,
      window_seconds: 60,
    });
    expect(error).toBeTruthy();
  });

  it("denies anonymous storage writes to every bucket", async () => {
    for (const bucket of PRIVATE_BUCKETS) {
      const { error } = await anon()
        .storage.from(bucket)
        .upload(`anon-denied/${Date.now()}.jpg`, new Blob(["x"]), {
          contentType: "image/jpeg",
        });
      expect(error, `expected upload denial for bucket ${bucket}`).toBeTruthy();
    }
  });

  it("denies anonymous storage listing of originals", async () => {
    const { data, error } = await anon()
      .storage.from(STORAGE_BUCKETS.originals)
      .list();
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });
});

describe.skipIf(!serviceReady)("live: schema semantics via service role", () => {
  const service = () =>
    createClient<Database>(liveUrl!, liveServiceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const batchIds: string[] = [];

  afterAll(async () => {
    const client = service();
    for (const id of batchIds) {
      await client.from("rachandzach_upload_batches").delete().eq("id", id);
    }
    await client.from("rachandzach_rate_limit_buckets").delete().eq("action", "schema-test");
  });

  it("cascades rachandzach_upload_items when a batch is deleted", async () => {
    const client = service();
    // rachandzach_upload_batches constrains receipt_hash to ^[0-9a-f]{32,64}$,
    // so a "test-..." prefix fails the check (23514) rather than exercising
    // the cascade this test exists to prove.
    const receipt = hexId();
    const batch = await client
      .from("rachandzach_upload_batches")
      .insert({ receipt_hash: receipt, status: "draft" })
      .select("id")
      .single();
    expect(batch.error).toBeNull();
    const batchId = batch.data!.id;
    batchIds.push(batchId);
    const item = await client.from("rachandzach_upload_items").insert({
      batch_id: batchId,
      original_name: "sample.jpg",
      object_path: `pending/${batchId}/sample.jpg`,
      bytes: 100,
      media_type: "image/jpeg",
      status: "pending",
    });
    expect(item.error).toBeNull();
    const del = await client.from("rachandzach_upload_batches").delete().eq("id", batchId);
    expect(del.error).toBeNull();
    const orphans = await client
      .from("rachandzach_upload_items")
      .select("id")
      .eq("batch_id", batchId);
    expect(orphans.data).toEqual([]);
  });

  it("rejects duplicate image_data_hash", async () => {
    const client = service();
    const hash = "f".repeat(32);
    const sha = "e".repeat(64);
    const base = {
      image_data_hash: hash,
      file_sha256: sha,
      original_bucket: STORAGE_BUCKETS.originals,
      original_object: `rachandzach_photos/${sha.slice(0, 16)}-dup-test.jpg`,
      original_filename: "dup-test.jpg",
      original_bytes: 10,
      source: "master" as const,
      status: "hidden" as const,
    };
    const first = await client.from("rachandzach_photos").insert(base).select("id").single();
    expect(first.error).toBeNull();
    const second = await client.from("rachandzach_photos").insert({
      ...base,
      original_object: `rachandzach_photos/${sha.slice(0, 16)}-dup-test-2.jpg`,
    });
    expect(second.error).toBeTruthy();
    await client.from("rachandzach_photos").delete().eq("id", first.data!.id);
  });

  it("rejects rachandzach_gallery_events metadata outside the allowlist", async () => {
    const client = service();
    const bad = await client.from("rachandzach_gallery_events").insert({
      event_name: "photo_view",
      metadata: { email: "someone@example.invalid" },
    });
    expect(bad.error).toBeTruthy();
    const good = await client
      .from("rachandzach_gallery_events")
      .insert({
        event_name: "photo_view",
        metadata: { surface: "gallery", duration_ms: 1200 },
      })
      .select("id")
      .single();
    expect(good.error).toBeNull();
    await client.from("rachandzach_gallery_events").delete().eq("id", good.data!.id);
  });

  it("rachandzach_consume_rate_limit allows up to the limit, then denies", async () => {
    const client = service();
    // Same constraint on rachandzach_rate_limits.key_hash: a leading "k" is
    // not hex, so the insert failed the check instead of testing the limiter.
    const key = hexId();
    const call = () =>
      client.rpc("rachandzach_consume_rate_limit", {
        key_hash: key,
        action: "schema-test",
        attempt_limit: 2,
        window_seconds: 3600,
      });
    const first = await call();
    const second = await call();
    const third = await call();
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);
    expect(second.data).toBe(true);
    expect(third.data).toBe(false);
  });
});/**
 * A unique lowercase-hex id that satisfies the `^[0-9a-f]{32,64}$` checks on
 * receipt_hash and key_hash. Two live tests previously built ids with a
 * non-hex prefix and failed the constraint, which read as a production
 * problem when it was only a malformed fixture.
 */
function hexId(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
}
