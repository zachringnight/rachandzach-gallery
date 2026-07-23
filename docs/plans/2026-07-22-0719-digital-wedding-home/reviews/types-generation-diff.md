# Types Generation Diff

**Verdict: MATCHES**

Compared the hand-written `src/lib/supabase/database.types.ts` against the
`rachandzach_*` slice of the freshly generated Supabase TypeScript types
(from the cached `generate_typescript_types` tool result, ~200 tables across
the shared PrizmLounge project, 408,167 decoded chars). No `database.types.ts`
or other repo file was edited. The large source file was not modified.

## Scope confirmed identical on both sides

- 12 `rachandzach_` tables in both files: `rachandzach_events`,
  `rachandzach_people`, `rachandzach_photos`, `rachandzach_photo_people`,
  `rachandzach_photo_keywords`, `rachandzach_photo_previews`,
  `rachandzach_upload_batches`, `rachandzach_upload_items`,
  `rachandzach_moderation_actions`, `rachandzach_notification_log`,
  `rachandzach_rate_limit_buckets`, `rachandzach_gallery_events`.
- 2 `rachandzach_` functions in both files: `rachandzach_consume_rate_limit`,
  `rachandzach_gallery_event_metadata_is_allowed`.
  - Note: the task brief mentioned "the 5 rachandzach_ functions." Only 2
    exist in the generated schema, and only 2 exist in the hand-written
    file. Not drift, both sides agree at 2; the "5" in the task brief does
    not match either source.
- 0 `rachandzach_` views, enums, or composite types in the generated schema
  (searched the full `Views`, `Enums`, and `CompositeTypes` sections of the
  generated file for any `rachandzach_`-prefixed entry, found none). The
  hand-written file correctly represents this with `[_ in never]: never` for
  Views, Enums, and CompositeTypes.

## Field-by-field comparison

For every table, checked Row/Insert/Update field names, TypeScript types,
nullability (`| null`), which fields are optional (`?`, i.e. have a
database default) vs required, and the `Relationships` foreign-key arrays.
For every function, checked `Args` and `Returns`.

Result: **exact semantic match** on all 12 tables and both functions. Every
field name, type, nullability marker, optional/required status, and FK
relationship (`foreignKeyName`, `columns`, `isOneToOne`, `referencedRelation`,
`referencedColumns`) in the hand-written file matches the generated schema.

Representative check (`rachandzach_photos`, the most complex table, 17
fields): required-without-default fields in both are exactly
`image_data_hash`, `file_sha256`, `original_object`, `original_filename`,
`original_bytes`, `source`; every other field is optional on Insert; all
fields optional on Update; nullable fields (`event_id`, `width`, `height`,
`captured_at`, `submitted_batch_id`, `approved_at`) match in both; both FK
relationships (`event_id` -> `rachandzach_events.id`, `submitted_batch_id`
-> `rachandzach_upload_batches.id`) match in both files, same order.

Function signatures also match exactly:

```
rachandzach_consume_rate_limit:
  Args: { key_hash: string; action: string; attempt_limit: number; window_seconds: number }
  Returns: boolean

rachandzach_gallery_event_metadata_is_allowed:
  Args: { metadata: Json }
  Returns: boolean
```

(Hand-written and generated agree on all four Args names/types for the
first function, and the single Args field for the second; field order
within `Args` differs between the two files but that carries no semantic
meaning for a TypeScript object type.)

## Cosmetic-only differences (not drift, not corrected)

These do not affect any of the checked categories (field names, types,
nullability, defaults, relationships, enum values, function signatures) and
so do not warrant a replacement file:

1. **Field ordering.** The generator alphabetizes fields within each
   Row/Insert/Update block and alphabetizes tables/functions within their
   sections. The hand-written file follows the migration's column order.
   Content is identical, order is not.
2. **Relationships array order** for `rachandzach_photo_people` only: the
   generated file lists the `person_id` FK before the `photo_id` FK
   (alphabetical), the hand-written file lists `photo_id` before
   `person_id`. Same two FK objects, same fields, just reordered. All other
   tables' Relationships arrays are in the same order in both files.
3. **Statement terminators.** The hand-written file ends each field and
   type member with `;`; the generated file (newer `supabase gen types`
   output style) omits semicolons and relies on newlines. Both are valid
   TypeScript for object type literals.
4. **Top-level wrapper.** The generated `Database` type (project-wide, not
   rachandzach_-specific) includes an `__InternalSupabase: { PostgrestVersion:
   "14.1" }` member that the hand-written `Database` type does not have.
   This is boilerplate added by a newer Supabase CLI version, unrelated to
   the rachandzach_ tables/functions themselves, and outside the explicit
   comparison scope (it affects every app sharing this project, not just
   this one).
5. **Helper-type names.** The generated file's bottom convenience types use
   a `DefaultSchema` / `DatabaseWithoutInternals` pattern (newer CLI
   codegen style) vs. the hand-written file's simpler `PublicSchema`
   pattern. Both expose equivalent `Tables<>`, `TablesInsert<>`,
   `TablesUpdate<>` helpers for the rachandzach_ tables; this is a
   project-wide generator style choice, not something specific to this
   app's schema.

## Conclusion

No corrected `database.types.generated.ts` was produced, per instructions,
since the comparison found no drift in any of the requested categories
(Row/Insert/Update fields, types, nullability, defaults, Relationships,
enums, function Args/Returns). The hand-written file at
`src/lib/supabase/database.types.ts` is safe to keep using as-is until a
local Supabase stack is available to run the real `types:generate` command
and diff again.
