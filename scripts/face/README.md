# Face-recognition moderation assist (pipeline half)

Local-only InsightFace pipeline that learns per-person face signatures from the
1,721 confirmed-tagged archive photos, supplements them with hand-picked saved
face crops, and audits existing tags against all available profiles.
Admin-side tooling only: nothing here is guest-facing, embeddings and reports
never leave local disk (`metadata/faces/` is gitignored), and the audit output
is a review list for a human, never an auto-correction. The admin-UI wiring
(proposing tags on new guest uploads in the review screen) is the next phase
and consumes `signatures.json` as its contract.

## Environment

Dedicated uv venv at the repo root (`.venv-faces/`, gitignore follow-up noted
in the handoff), CPython 3.12.13, created and provisioned with:

```bash
uv venv .venv-faces --python 3.12
uv pip install -p .venv-faces/bin/python \
    insightface==0.7.3 onnxruntime==1.27.0 numpy==1.26.4 \
    pillow==12.3.0 opencv-python-headless==4.11.0.86
```

Exact pins that matter (`uv pip freeze -p .venv-faces/bin/python`), verified on
macOS arm64 (Apple M5, CPU execution provider):

```
insightface==0.7.3
onnxruntime==1.27.0
numpy==1.26.4
pillow==12.3.0
opencv-python-headless==4.11.0.86
# insightface transitives resolved alongside:
onnx==1.22.0  scipy==1.17.1  scikit-learn==1.9.0  scikit-image==0.26.0
albumentations==2.0.8  cython==3.2.8
```

`numpy` stays below 2.0 on purpose: insightface 0.7.3 predates numpy 2 and the
1.26 line is the known-good pairing with these onnxruntime/opencv builds.

Model: `buffalo_l` (SCRFD 10G detector + w600k_r50 ArcFace recognizer),
auto-downloaded once by insightface (~275 MB) to `~/.insightface/models/buffalo_l/`.
Only the detection and recognition modules are loaded; landmark and gender/age
models are skipped.

## Scripts

### 1. `build-face-signatures.py`

```bash
uv run --no-project --python .venv-faces/bin/python \
    scripts/face/build-face-signatures.py
```

Phase 1 (slow, resumable): reads originals from the source master (READ-ONLY,
`/Users/zsoskin/Downloads/Rachel & Zach - Wedding Master Clean`), decodes each
JPEG at a bounded long edge (2048 px, JPEG draft-mode fast path), detects at a
bounded det size (640), embeds every face, and appends one JSON line per photo
to `metadata/faces/detections.jsonl`. Ctrl-C any time; the next run resumes
from the checkpoint (a truncated trailing line from a hard kill is dropped
automatically). `--limit N` processes at most N new photos (smoke tests).
Full-archive pass measured 2026-07-22 on the M5: 12.5 min wall for 1,709
photos (2.3 photos/s, 6,535 faces; 3 decode threads feeding a single
inference thread, bounded prefetch queue). A complete checkpoint makes
re-runs skip phase 1 entirely; phase 2 then reproduces signatures.json
byte-for-byte in about a second.

Phase 2 (fast, deterministic, re-runs automatically once phase 1 is complete):

1. **Cluster**: faces with det score >= 0.65 and bbox height >= 1.8% of the
   long edge enter a union-find over cosine similarity >= 0.60, followed by
   greedy centroid-level merges down to 0.52. Two guards keep lookalikes and
   relatives apart: faces in the same photo never union directly, and two
   clusters that appear together in >= 2 photos never merge (one person cannot
   be in a frame twice).
2. **Name by co-occurrence**: in a photo tagged with k people, only the k most
   prominent clustered faces carry tag evidence, each at weight 1/k, so solo
   and small-group photos anchor identities. A cluster earns a slug only with
   support across >= 3 photos (>= 2 for people with <= 4 tagged photos), a
   weighted-score lead of >= 1.6x over the runner-up slug, and no same-frame
   contradiction with clusters already assigned to that slug. Up to 4
   explaining-away passes let confident assignments absorb ambiguous evidence
   (a photo tagged {rachel, zach} where zach's cluster is already present stops
   counting toward other clusters for the zach tag).
3. **Write `metadata/faces/signatures.json`**: per person: slug, name, one or
   more cluster centroids (512-d unit vectors), face/photo counts, support,
   solo-anchor count, confidence; plus unresolved multi-face clusters with
   their top co-occurring tags (the raw material for naming more people
   later), calibration percentiles, params, and an inputs fingerprint.

### 2. `audit-archive-tags.py`

```bash
uv run --no-project --python .venv-faces/bin/python \
    scripts/face/audit-archive-tags.py
```

Pure numpy over the saved artifacts (no model inference), so it finishes in
seconds and is byte-for-byte idempotent for unchanged inputs (outputs carry an
inputs fingerprint instead of timestamps). The fingerprint hashes the
identity-bearing override fields and ignores the export-only `exportedAt`
timestamp, so a no-change live readback cannot invalidate an existing review
packet. It combines 108 learned signatures with the 23 hand-picked crops in
`src/generated/person-overrides.json`, giving the current archive 131 saved
profiles. A crop anchor is accepted only when one detected face contains the
crop center and covers at least 80% of the crop; ambiguous or unresolved crops
fail closed. Writes
`metadata/faces/audit-report.json` and `metadata/faces/audit-report.md`, ranked
by confidence:

- **(a) tagged-but-no-matching-face**: severity `high` means the photo has
  enough usable faces for everyone tagged and each one identified as somebody
  else (tag probably wrong); `medium` means enough faces but some went
  unidentified; `low` means the face simply is not usable in the frame (back
  turned, occluded), the tag is probably fine and rows are only summarized.
- **(b) confident-face-but-untagged**: prominent faces only (bbox height
  >= 3.5% of long edge, det score >= 0.70) matching a signature at cosine
  >= 0.55 with >= 0.08 margin over the runner-up person. Incidental background
  guests never flag by design. `strong` tier at >= 0.62 is near-certain.

Bucket (b)'s floors are flags, so a wider review wave can reach the
mid-ground guests the defaults exclude. Every default is the calibrated
constant, so a bare run still reproduces the report byte for byte; the params
feed the inputs fingerprint, so a widened report can never be mistaken for a
calibrated one. Always widen into a SEPARATE report so the baseline survives:

```bash
uv run --no-project --python .venv-faces/bin/python \
    scripts/face/audit-archive-tags.py \
    --min-untagged-face-frac 0.015 --min-untagged-det-score 0.60 \
    --min-untagged-sim 0.48 \
    --report-json metadata/faces/audit-report-wide.json \
    --report-md metadata/faces/audit-report-wide.md
```

Measured 2026-07-27 on this archive: dropping the face fraction from 0.035 to
0.015 took bucket (b) from 15 rows to 284 (109 of them `strong`, across 60
people and 83 photos). Those were withheld purely on face size, not match
quality; the top of the strong tier sits at 0.72-0.84 with margins up to 0.68.
Keep `--min-untagged-margin` at 0.08 unless you have a reason: that guard is
what holds the Soskin siblings apart (impostor max 0.592).

Two things to watch when reviewing a widened wave. Where both the saved
profile and the candidate wear sunglasses, shared occlusion can inflate
similarity, so confirm on face shape and hair rather than the score. And small
faces are often underexposed; a crop too dark to judge is a hold, not a yes.

### Correcting a signature that learned the wrong person

`metadata/face-profile-corrections.json` lists slugs whose LEARNED signature
is somebody else's face. For each one the audit drops the learned clusters
and uses the hand-picked `/admin/faces` crop instead.

Both halves matter. `saved_crop_anchors` normally skips anyone who already
has a learned signature, so without this a corrected crop would never reach
the recognition profile: the guest-facing thumbnail would change and matching
would carry on using the wrong face. Dropping the clusters is what stops the
wrong person continuing to win matches.

A corrected slug with no crop yet ends up with no profile at all, and is
reported under `correctedProfiles.awaitingCrop`. That is deliberate: no
profile beats a confidently wrong one.

An absent or empty file behaves exactly as every run before this existed,
fingerprint included; corrections only enter the fingerprint when present.

Recorded so far: `maura-keith-gutierrez`, whose signature is Chris
Gutierrez. `chris-gutierrez` had no learned signature of his own, so
co-occurrence naming attached his face cluster to her slug. Watch for this
shape wherever a couple appears together often and only one of them ever
resolves.

## Thresholds and calibration

All thresholds live as named constants at the top of each script and were
checked against this archive's measured distributions (the 2026-07-22 full
run, 6,535 faces, 108 of 132 tagged people resolved):

- genuine (assigned faces vs their own centroid): p05 = 0.575, p25 = 0.691,
  median = 0.770 (same-day hair, makeup, and lighting keep sims high)
- impostor (a person's centroid vs other assigned people's faces, peak per
  cluster pair): p95 = 0.185, p99 = 0.250, max = 0.592 - and that max is
  parker-soskin vs riley-soskin, real family lookalikes; the next-closest
  cross-person centroid pair sits at 0.425
- so: clustering edges at 0.60 sit above every cross-person centroid sim,
  centroid merges at 0.52 reconnect pose/expression fragments, the audit
  "present" floor of 0.36 is far below genuine p05, and untagged flags at
  0.55 (strong: 0.62) clear every impostor peak except the Soskin siblings,
  which the 0.08 runner-up margin rule absorbs

`signatures.json` re-reports genuine/impostor percentiles from the final
assignment under `calibration` on every run; if those drift after a re-tag
wave, revisit the constants.

### 3. `render-tag-review-sheets.py`

```bash
uv run --no-project --python .venv-faces/bin/python \
    scripts/face/render-tag-review-sheets.py \
    --min-sim 0.72 --min-margin 0.15
```

Renders the committed saved profile beside the proposed detected face using
only `public/faces/*.webp` and local 1600px derivatives. It never opens
originals or changes tags.

`--report` selects which audit report supplies candidates (default: the
calibrated one). Because the calibrated report already drops mid-ground faces
upstream, lowering `--min-sim` alone can never surface them; point `--report`
at a widened run instead, and give it its own `--output-dir` so an earlier
wave's sheets are not deleted:

```bash
uv run --no-project --python .venv-faces/bin/python \
    scripts/face/render-tag-review-sheets.py \
    --report metadata/faces/audit-report-wide.json \
    --min-sim 0.62 --min-margin 0.08 \
    --output-dir metadata/faces/review-strong-wave
``` Sheets stay under ignored `metadata/faces/` and
must be reviewed visually before a pair is added to the tracked
`metadata/reviewed-face-tag-additions.json` overlay.

### 4. `review-zero-tag-photos.py`

```bash
uv run --no-project --python .venv-faces/bin/python \
    scripts/face/review-zero-tag-photos.py
```

Audits the narrower blind spot where a catalog photo has detected faces but no
people tags at all. It compares every clustering-eligible face with all 131
saved profiles, groups repeated detections with the archive-calibrated
same-face clustering rules, and sorts recurring unknown faces ahead of
singletons. It renders:

- full-photo sheets with every detected face boxed, including detections too
  small or soft for identity comparison; and
- face sheets sorted by same-face cluster, with the closest saved profile,
  runner-up matches, score, margin, and quality tier.

The machine-readable and Markdown reports plus both sheet sets stay under the
ignored `metadata/faces/zero-tag-review*` paths. The script reads only the
catalog, local face artifacts, committed face thumbnails, and local preview
derivatives. It never opens an original and never applies a tag. Review
decisions remain explicit rows in
`metadata/reviewed-face-tag-additions.json`; a review wave can carry its own
recorded thresholds when visual context confirms a face below the default
saved-profile score.

### 5. Private recurring-face tagger

```bash
npm run faces:recurring
```

Builds and opens
`metadata/faces/recurring-face-tagger/index.html`, a local-only review surface
for the repeated unnamed clusters produced by step 4. It currently shows 13
same-face groups (31 face instances across 10 photographs) and lets Zach:

- compare every crop in a group and open the full photograph with the face
  boxed;
- search all 189 current catalog identities, including seated attendees who
  do not have a tagged photograph or saved face yet;
- compare a selected identity with its committed saved face when one exists;
- confirm one identity for the entire cluster or hold it for later; and
- restore or download the review decisions as JSON.

The page saves drafts in browser local storage. Its HTML, private preview
references, and decisions stay under ignored local paths; it contains no
embeddings and deliberately omits model-similarity suggestions so the
reviewer makes the identity decision.

Import a downloaded decision file in read-only mode first:

```bash
npm run faces:recurring:apply -- \
  ~/Downloads/rachandzach-recurring-face-decisions.json
```

Add `--write` only after the dry-run is correct. Write mode validates the
exact report fingerprint, every cluster and person, photo-path drift, and
same-person conflicts before writing the tracked additive face-tag overlay and
generated local catalog. Each file is replaced atomically. Human cluster
assignments are recorded as their own review wave without inventing a model
similarity score.

The importer never syncs live data. Use the existing narrow sync separately:

```bash
node scripts/sync-catalog-overlays.mjs
node scripts/sync-catalog-overlays.mjs --execute
```

The first command is read-only. `--execute` writes an ignored pre-state backup,
performs only additive confirmed tag upserts, and verifies the live result.

## Privacy and safety rails

- Source master opened read-only; only the catalog and `metadata/faces/` are
  written.
- The zero-tag review does not open the source master at all; it uses local
  preview derivatives and keeps its contact sheets private.
- The recurring-face tagger uses those same local derivatives; its generated
  page and browser decisions remain gitignored.
- Embeddings, signatures, and reports stay on local disk (gitignored), service
  workflows never see them in this phase.
- The audit is a review list: a human confirms every row against the actual
  photo before any tag changes, and low-severity rows exist precisely because
  a missing face match usually means "back of head", not "wrong tag".
