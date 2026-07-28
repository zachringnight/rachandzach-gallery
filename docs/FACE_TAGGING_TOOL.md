# Face tagging tool

A local, offline workbench for putting names to the faces the automatic
pipeline could not resolve. Built for a long naming session with someone who
knows the guests, which in practice means Rachel.

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
| `Shift+Enter` or `\` | same person in every photo in the look-alike row |
| `Shift+1…9` or `,` | take the name but stay (a second person in one photo) |
| `Esc` | clear the box; on an empty box, "not sure" and move on |
| `−` | not a wedding guest |
| `=` | cycle close-up / with surroundings / whole photo |
| `Tab` / `Shift+Tab` | next / previous without answering |
| `⌘Z` | undo (works across the whole session) |
| `P` | browse all guests with their saved faces |
| `?` | show this list in the page |

## Where the answers go

Decisions apply immediately. There is no separate approval step.

- Confirmed names → `metadata/reviewed-face-tag-additions.json`
- "Not a guest" and "not sure" → `metadata/identity-review/naming-decisions.json`

Both are tracked in git. The second one is the only record of what was ruled
out, and it is what lets a session resume where it stopped, so it is
deliberately exempted from the `metadata/identity-review/*` ignore rule. If it
ever goes missing, every dismissed face gets asked again with no way to know
which those were.

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
