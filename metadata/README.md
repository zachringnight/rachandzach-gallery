# People Metadata Workflow

This folder is the review layer for wedding-photo people tags.

The original JPEGs already contain Lightroom/XMP people tags. Do not edit those
original files during review. Reviewers and agents should write corrections to:

`metadata/people-corrections.csv`

## Correction Schema

```csv
path,action,people,notes,reviewer,updated_at
```

- `path`: source-relative photo path, for example `Ceremony/rachelzach-195.jpg`
- `action`: `replace`, `add`, `remove`, `ignore`, or `exclude`
- `people`: semicolon-separated names, for example `Rachel Casciano; Zach Soskin`
- `notes`: short reason or uncertainty note
- `reviewer`: reviewer/agent name
- `updated_at`: ISO timestamp

## Action Semantics

- `replace`: use exactly the listed people for this photo.
- `add`: add listed people to existing embedded metadata.
- `remove`: remove listed people from existing embedded metadata.
- `ignore`: reviewed and intentionally no people tags.
- `exclude`: omit this photo from the public gallery.

The generator merges this CSV into the gallery index. Originals remain unchanged.

## Tracked catalog overlays

Two reviewed, names-only manifests preserve guest identities and confirmed
face-tag additions across catalog rebuilds:

- `wedding-attendees.json` contains all 183 unique attendees from the final
  seating chart. It stores only the seating name, resolved person slug,
  display name, and resolution (`existing`, `alias`, or `added`). It does not
  contain table, seat, meal, notes, contact details, or workbook metadata.
- `reviewed-face-tag-additions.json` contains only photo hashes/paths, person
  slugs/names, review scores, and the saved-profile source for visually
  approved tag links.

`scripts/build-gallery-v2.mjs` applies both manifests during every catalog
rebuild. To check or refresh the current committed generated catalog without
opening or changing originals:

```bash
node scripts/apply-catalog-overlays.mjs
node scripts/apply-catalog-overlays.mjs --write
```

The live sync is read-only by default. Its explicit execution mode is
additive-only, writes an ignored local pre-state backup, and re-reads the live
tables before reporting success:

```bash
node scripts/sync-catalog-overlays.mjs
node scripts/sync-catalog-overlays.mjs --execute
```
