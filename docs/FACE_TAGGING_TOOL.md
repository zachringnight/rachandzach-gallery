# Face tagging tools

Two ways to put names to the faces the automatic pipeline could not resolve.

**Start with the contact sheets.** They are faster by a wide margin, and they
were what actually worked: 90 stacks and 264 faces were named in one evening
by looking at printed sheets and calling out answers, after a browser session
of the same length had managed 107 single-face decisions.

```bash
node scripts/face/render-stack-sheets.mjs      # clear, numbered stacks of nameless faces
open metadata/faces/stack-sheets/              # flip through them in Preview
node scripts/face/apply-stack-names.mjs answers.txt          # dry run
node scripts/face/apply-stack-names.mjs answers.txt --write  # apply
```

Answers are one per line, in the shape a person types while reading:
`3 Linda Willey`, `7 Danny Listrani`, `12 skip`, `18 !blurry`, `4 !notguest`.
A name must resolve to exactly one guest or the whole batch aborts before
writing. Naming a stack tags every face in it EXCEPT any already answered, so
a sweep can never overwrite a more considered decision.

Each sheet cell shows up to three of the stack's clearest faces, how many
photographs the name would reach, and **who is already tagged in those
photographs**. That last line is the real hint: these stacks exist precisely
because no saved profile matched, so the model has nothing to suggest, but
"standing beside two Myerses" usually lets a human place the face at once.
By default the sheets hold back stacks with no usable view; pass
`--include-blurry` only for the long tail. The header lists every seated guest
who appears in no photograph, because those two lists are largely the same
people.

When a reviewer can rule out a suggested name but cannot yet identify the
face, record that pair in
`metadata/identity-review/stack-candidate-rejections.json`. The renderer uses
the stable stack ID, not the temporary sheet number, to suppress that one name
on later sheets while leaving the stack open for another pass.

Two more tools worth knowing:

- `scripts/face/deduce-unmatched-tags.mjs` reads names a human already put on
  a photograph and works out which face they belong to. When exactly one name
  and one face are left unmatched, the face is that person by elimination, no
  model similarity involved. It writes nothing; it prints candidates.
- `scripts/face/merge-person.mjs <from> <into>` merges two records of the same
  person (a maiden and a married name, say) across the reviewed overlay, the
  local catalog and the live database, and prints the master-metadata command
  to finish the job.

## The browser tagger

A local, offline workbench that asks one face at a time. Better than the
sheets when a face needs its surrounding photograph, the look-alike row, or a
zoom to answer.

## Run it

```bash
npm run tag
```

Then open:

**http://127.0.0.1:4310/**

It opens the browser itself. Press `Ctrl+C` in that terminal when finished.

The address is fixed and loopback-only: it binds to `127.0.0.1`, so it is
reachable from this machine and nothing else. Nobody on the wifi, and nothing
on the internet, can see it. It is not part of the deployed site and never
runs on Vercel.

## What it shows

A large face crop beside the whole photograph with the face outlined, a
search box, and the list of known guests. Faces that look like the same
person are grouped into a row, so one keystroke can name several photos at
once.

## Keyboard

Every command key is one that cannot appear in a name, so the search box
keeps focus the whole time. No mouse needed.

| Key | Action |
|---|---|
| type letters | search the guest list |
| `Enter` | that's them, saves and moves on |
| `1`–`9` | pick that name from the list |
| `↑` `↓` | move the highlight |
| `Shift+Enter` or `\` | same person in every photo in the look-alike row; with an empty box it reuses the name already on that row, so naming one face then sweeping the rest is two keystrokes |
| `Shift+1…9` or `,` | take the name but stay (a second person in one photo) |
| `Esc` | clear the box; on an empty box, "not sure" and move on |
| `Shift+Esc` | "not sure" for the whole look-alike row |
| `−` | not a wedding guest |
| `_` | not a guest, whole row |
| `[` | too blurry or too small to name, never ask again |
| `{` | too blurry, whole row |
| `=` | cycle close-up / with surroundings / whole photo |
| `Tab` / `Shift+Tab` | next / previous without answering |
| `⌘Z` | undo (works across the whole session) |
| `P` | browse all guests with their saved faces |
| `?` | show this list in the page |

## Where the answers go

Decisions apply immediately. There is no separate approval step. Both tools
write to the same two files, so a sheet answer and a keystroke answer are
indistinguishable afterwards and a session can move between them freely.

- Confirmed names → `metadata/reviewed-face-tag-additions.json`
- "Not a guest", "not sure" and "too blurry" →
  `metadata/identity-review/naming-decisions.json`
- Rejected context-based suggestions →
  `metadata/identity-review/stack-candidate-rejections.json`

"Not sure" is deliberately re-askable: it means nobody could place the face
then, and a later pass should ask again. "Too blurry" and "not a guest" are
settled and never come back. Every whole-row sweep skips faces that already
carry a settled answer.

All three are tracked in git. The two decision ledgers are the only records of
what was ruled out, and they let a session resume without repeating settled
questions, so both are deliberately exempted from the
`metadata/identity-review/*` ignore rule. If they go missing, dismissed faces
or rejected suggestions can be asked again with no record of the earlier
answer.

Writes are atomic (temp file, fsync, rename) and validated against a throwaway
catalog copy before anything touches disk, and all decision files are backed up
to `metadata/identity-review/backups/` at launch. Undo reverts the written
record, not just the screen.

## After a session

```bash
node scripts/apply-catalog-overlays.mjs --write     # names into the catalog
node scripts/build-face-thumbnails.mjs              # refresh Find me faces
python3 scripts/write-additions-to-master.py        # DRY RUN, shows what would change
python3 scripts/write-additions-to-master.py --write
```

The last step writes the names into the original JPEGs' embedded metadata
(`XMP-iptcExt:PersonInImage`, `XMP-dc:Subject`, `IPTC:Keywords`), so they
travel with the photographs into Apple Photos, Lightroom, or whatever exists
in twenty years, independent of this site. It edits in place with no exiftool
sidecar, which is why it previews by default and needs `--write` to act. See
the metadata clause in `AGENTS.md`.

## The files

| File | Role |
|---|---|
| `scripts/tag-faces.mjs` | the session server (`npm run tag`) |
| `scripts/lib/naming-tool.mjs` | queue model and page |
| `scripts/lib/naming-decisions.mjs` | atomic writes, undo stack, validation |
| `scripts/build-naming-tool.mjs` | read-only preview page; cannot save |

`build-naming-tool.mjs` writes a static preview to
`metadata/identity-review/name-people.html` with its controls disabled. It
exists so the page can be inspected without a server, and it deliberately
cannot save. **Use `npm run tag` to do real work.**
