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
