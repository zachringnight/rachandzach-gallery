# Agent Review Outputs

Agents review `metadata/audit/review-sheets/*.jpg` and write one CSV per assigned
batch here. Review the actual visuals. Do not trust Lightroom/XMP names as
correct unless the visual evidence supports them.

Do not guess identities unless a person is unmistakable from the image itself.
Rachel and Zach can be tagged when visually obvious. Unknown guests should be
`needs_identity`, even if an embedded metadata name exists elsewhere.

Schema:

```csv
path,recommendation,people,confidence,notes
```

Recommendations:

- `ignore`: no useful person tag needed, such as details, objects, empty venue,
  landscape, or people too tiny/occluded to support name search.
- `needs_identity`: one or more identifiable people are visible, but the agent
  cannot safely name them.
- `replace`: only when identities are obvious and can safely replace empty tags.
- `exclude`: keep out of the public gallery.

`people` is semicolon-separated and should be blank unless `recommendation` is
`replace`.
