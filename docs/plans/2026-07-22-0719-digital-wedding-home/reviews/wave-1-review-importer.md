# Wave 1 review: packet 02 read-only media importer

Adversarial static review of the landed importer against the packet 02 contract. No code was executed; data claims below come from reading the committed report, catalog, manifest CSV, and scripts. Verdict up front: the core guarantees hold (streamed SHA-256, read-only source handling, atomic same-volume renames, hash provenance recorded and re-verified), but derivative dimension verification is width-only, which is direct contract drift and the one defect that can silently corrupt catalog metadata. Fix F1 and F2 at the wave boundary; the rest are hardening.

## Findings (ranked)

### F1. MEDIUM-HIGH: Derivative verification checks width only; height and orientation can be silently wrong for EXIF-rotated sources

- Where: scripts/lib/image-derivatives.mjs:68-81 (`verifyDerivative`), :121-132 (emits `plan.height`, never measured height); scripts/lib/clean-master-manifest.mjs:120-123 (`classifyOrientation` from manifest dims)
- Contract drift: packet 02 line 79 requires atomic rename only after each output "decodes and matches its planned dimensions". The code verifies `metadata.width === plan.width` and only `height >= 1`. The emitted PreviewObject records `plan.height`, not the decoded height.
- Failure scenario: manifest width/height come from exiftool `-ImageWidth`/`-ImageHeight` on the source record (scripts/prepare-clean-master.py:716-717), which are encoded dimensions and ignore the EXIF Orientation tag. `generateDerivatives` calls `.autoOrient()` (image-derivatives.mjs:107-109), which rotates pixels. For a source encoded 4000x6000 with Orientation 6 (visually 6000x4000): the loader classifies it portrait and plans 480x720; sharp produces 480x320 landscape; `verifyDerivative` passes because width matches; the catalog publishes orientation "portrait" and height 720 for a file that is actually 480x320. No error anywhere. The width-set selection in `buildDerivativePlan` (image-derivatives.mjs:42-50) is also computed from the encoded width, so rotated sources can gain or lose planned widths relative to their visual width.
- Exposure: prepare-clean-master.py never inspects or normalizes Orientation (no matches in that file), so rotation flags pass through from the photographer export. Lightroom exports typically bake rotation, and the current catalog splits 1483 portrait / 238 landscape / 0 square with no visible anomaly, so the live data is probably clean, but nothing in code or tests proves it: no fixture sets an Orientation tag, so this path is entirely untested.
- Minimal fix: (1) in `verifyDerivative`, assert `Math.abs(metadata.height - plan.height) <= 1`; (2) record the measured `metadata.height` in the emitted object instead of `plan.height`; (3) optionally, in the loader read `parsed.Orientation` from exifr (already parsing tiff) and swap manifest width/height when Orientation >= 5 before classification and planning. (1)+(2) alone convert silent corruption into a loud abort, which satisfies the contract.

### F2. MEDIUM: No row-width validation in the CSV loader; a shifted row imports with wrong people attribution

- Where: scripts/lib/clean-master-manifest.mjs:227-297 (`columnIndex` map, `cell()` accessor, row loop)
- Failure scenario: a data row with an extra unquoted comma in a middle column (e.g. `lightroom_people`, index 11) shifts every later cell by one, so `final_people` (index 14) reads the `people_added` content. All validated columns (output_path, hash, width, height, sizes) sit at indices 0-8 and are unaffected, so the row passes every check and imports with the wrong people list. Short rows degrade to "" via `?? ""` similarly without complaint. The current machine-generated manifest quotes correctly, but the loader claims an "explicit schema" (packet line 73) while never confirming the cell count.
- Minimal fix: after header validation, reject any row where `row.length !== header.length` with a `bad_row` issue.

### F3. MEDIUM-LOW: Source-write detection window excludes pass 1; the report's "zero source writes" overclaims

- Where: scripts/build-gallery-v2.mjs:181 (`preStat` taken after `loadCleanMasterManifest` returns), :256-259, report field `sourceIntegrity.sourceWrites`
- Failure scenario: the loader streams every byte of all 1721 files (SHA-256 + exifr), a pass that takes minutes over 11.6 GiB, before the first stat snapshot exists. A write bug inside the loader, or a concurrent writer during pass 1, is invisible to the size+mtime diff, yet the report asserts `sourceWrites: 0` "across the whole run" (comment at :256). In verify-only mode without exiftool there is no second content check at all, so nothing covers that window. By inspection the loader uses only readFile/stat/createReadStream/exifr, so this is a detection-scope gap, not an active write path.
- Minimal fix: stat all candidate paths immediately after CSV validation and before hashing (inside or just before the loader), and diff against the end-of-run snapshot; or scope the report claim to what was actually measured.

### F4. MEDIUM-LOW: `duplicateIds` metric counts rejected duplicate rows as catalog duplicate IDs

- Where: scripts/build-gallery-v2.mjs:261-263
- Failure scenario: the loader already rejects duplicate `image_data_hash` rows (clean-master-manifest.mjs:264-267), so `catalog.photos.length - uniqueIds.size` is always 0 and `duplicateIds` equals the count of rejected duplicate rows. A future snapshot with one legitimately rejected duplicate row would report `duplicateIds: 1` against a catalog that has zero duplicate IDs, failing the done-check gate "zero duplicate IDs" for the wrong reason and double-counting the row already present in `rejectedRows` and `issues`.
- Minimal fix: `const duplicateIds = catalog.photos.length - uniqueIds.size;` and let duplicate_hash rejections live only in `issues`/`rejectedRows`.

### F5. LOW: exiftool verification batch aborts wholesale on any file error and inherits ImageHashType from user config

- Where: scripts/build-gallery-v2.mjs:136-152 (`exiftoolImageHashes`)
- Failure scenario: exiftool exits nonzero when any file in a 160-file batch errors; `execFileAsync` rejects and the JSON for the other 159 files (still present on stdout) is discarded, so one unreadable file kills the whole verification with a raw exception instead of a per-file mismatch entry. Separately, the invocation does not pin `-api ImageHashType=MD5`; a user-level `.ExifTool_config` overriding ImageHashType would mismatch all 1721 files while the report still records the algorithm as MD5. Both failure modes are noisy, not silent.
- Minimal fix: add `-api`, `ImageHashType=MD5` to the arg list; on execFile rejection, parse `error.stdout` and record files missing from the result as mismatches.

### F6. LOW: Manifest read twice; reported manifestSha256 has a TOCTOU gap against the parsed bytes

- Where: scripts/build-gallery-v2.mjs:165-168 (hash read) vs scripts/lib/clean-master-manifest.mjs:214 (parse read)
- Failure scenario: if the manifest changes between the two reads, the report's `manifestSha256` does not describe the CSV that was actually parsed, undermining the report as a provenance record.
- Minimal fix: read once; hash the same buffer the loader parses (accept pre-read text in the loader, or have the loader return the manifest hash).

### F7. LOW: `--limit` runs emit a report shaped like a full verification

- Where: scripts/build-gallery-v2.mjs:174-176
- Failure scenario: slicing `catalog.photos` after load leaves `stats.importedPhotos` at the full count while `counts.uniquePrimaryPhotos` reflects the slice, and no report field records that a limit was applied. A limited debug run writes over the canonical report/catalog paths and could be mistaken for (or clobber) a real verification.
- Minimal fix: record `limit` in the report and refuse to write to the default catalog/report paths when a limit is active.

### F8. LOW: exifr catch-all conflates "no metadata" with "metadata read failed"

- Where: scripts/lib/clean-master-manifest.mjs:160-175 (`readEmbeddedMetadata`)
- Failure scenario: any exifr throw (corrupt segment, library bug on valid XMP) silently yields `capturedAt: null, keywords: []`, indistinguishable from a photo that genuinely lacks EXIF. The report's `photosWithCapturedAt: 1472` cannot show whether the other 249 are absent data or parse failures. Non-fatal by design (packet: missing stays null), but determinism is unobservable.
- Minimal fix: count parse exceptions into a non-fatal issue type (e.g. `exif_read_failed`) so the report separates the two cases.

### F9. LOW (latent): Person slug collisions merge silently

- Where: scripts/lib/clean-master-manifest.mjs:315-323
- Failure scenario: two distinct authoritative labels that slugify identically ("Bond, Lauren" and "Bond Lauren") merge into one person keyed by the first-seen name, with combined counts and no report entry. Checked statically against the live manifest: 132 distinct names produce 132 distinct slugs, so no current impact.
- Minimal fix: when `personNamesBySlug` already holds the slug with a different name, append a non-fatal issue.
- Resolution (2026-07-22, wave-boundary fix pass): documented behavior, no code change. Slug generation is left as-is by decision: 0 live collisions across the 132 authoritative names, and redesigning slugs mid-wave would ripple into people URLs consumed by downstream packets. Behavior note for consumers: if two distinct labels ever slugify identically, they merge under the first-seen display name with combined counts. Revisit only if the people list changes.

### F10. INFO (data semantics, for downstream packets): keywords largely duplicate people names

- The clean-master pipeline baked `final_people` into embedded dc:Subject/IPTC Keywords (prepare-clean-master.py:671-679), so the importer's contract-compliant EXIF read yields keywords that contain person names for 1476 of 1721 photos (checked against src/generated/gallery-v2.json), plus generic tags like "Wedding". Any packet that treats `keywords` as topical tags or a search facet will surface name duplicates of `peopleSlugs`. Not an importer defect; flagging so downstream consumers filter or dedupe deliberately.

### F11. LOW: Excluded-path check is case-sensitive; `..` rejection is over-broad

- Where: scripts/lib/clean-master-manifest.mjs:182-186, :252
- Failure scenario: a manifest row with `by person/...` evades `isExcludedPath` yet stats successfully on case-insensitive APFS, importing via the By Person symlink (likely then caught as duplicate_hash if the primary row exists, but not guaranteed). Conversely a legitimate filename containing ".." (e.g. `photo..jpg`) is rejected with a misleading "excluded directory" message. Both edges fail visibly or safely; hardening only.
- Minimal fix: compare case-insensitively for exclusions and restrict the traversal check to path segments equal to `..`.

## Clean areas (verified, one line each)

- fileSha256 is truly streamed: createReadStream with incremental hash update (clean-master-manifest.mjs:125-133), and full mode re-streams per photo after derivative generation (build-gallery-v2.mjs:235-241).
- imageDataHash is handled per the recorded decision: opaque identity in the loader (format check only), re-verified out-of-band via exiftool when present, decision string and exiftool version recorded in the report; provenance claim matches prepare-clean-master.py, and the landed report shows 1721/1721 verified, 0 mismatches.
- Read-only guarantee: no write-capable API is ever pointed at the source tree; all writes target the derivatives root, catalog, and report paths (subject to F3's detection-window caveat, which is about proof, not behavior).
- Derivative atomicity: staging dir is mkdtemp'd inside outputRoot, so staging and final path share a volume and fs.rename is atomic on APFS; all outputs for a photo are verified before any rename; a crash mid-publish loop leaves a partial photo that a rerun heals idempotently. (No fsync before rename, so power-loss durability is not guaranteed; acceptable for a regenerable local cache.)
- CSV parsing: RFC-4180 quoted commas/escaped quotes/embedded newlines handled and fixture-tested; trailing blank rows filtered; CRLF handled; a UTF-8 BOM on the header cell is neutralized by `.trim()` (U+FEFF is JS whitespace); the real manifest was byte-checked and carries no BOM. Remaining quirk: an unquoted mid-field `"` flips quote mode and swallows a following comma, undefined under RFC-4180 and unreachable in machine-generated output.
- Derivative policy matches the packet: strictly-smaller width gate, AVIF+WebP at 480/960/1600, JPEG at 2400, object path and immutable Cache-Control exact, no upscaling (withoutEnlargement plus the width check makes a lying manifest abort, and that abort is tested).
- ICC and orientation intent: `.keepIccProfile()` plus `.autoOrient()` on the shared pipeline, with a P3-profile fixture asserting ICC presence in every emitted format.
- Contract surface: package.json wires `gallery:import` to build-gallery-v2.mjs; all packet interface fields exist in src/types/gallery.ts and in the emitted catalog (spot-checked src/generated/gallery-v2.json: 1721 photos, all record keys present); By Person is never crawled (manifest-driven only); legacy build-gallery.mjs left in place pending packet 12 cutover as specified.
- Landed verify-only report matches the done-check: 1721 unique primary photos, 0 duplicate IDs, 0 rejected rows, 0 source writes, 0 hash changes.

## Suggested wave-boundary order

1. F1 (verify height + record measured height; optional orientation swap in loader)
2. F2 (row-width validation)
3. F4 (duplicateIds semantics, protects the done-check gate)
4. F3 (move preStat before pass 1)
5. F5/F6/F7/F8 as a small hardening batch; F9/F11 optional; F10 is a note to downstream packets, no importer change.

## Wave-boundary fix status (2026-07-22)

- Fixed: F1 (both axes measured, measured values recorded, orientation swap in loader, Orientation=6 fixture tests), F2 (row-width vs header with line number), F3 (pre-read stat snapshot taken inside the loader during row validation, before any content read), F4 (duplicateIds counts emitted-catalog duplicates only; rejected duplicate rows reported as duplicatesRejected and non-gating), F5 (per-file exiftool tolerance plus -api ImageHashType=MD5 pin), F6 (manifest read once; hash covers the parsed bytes), F8 (per-file exifr errors recorded as stats.metadataErrors), F11 (case-insensitive exclusions; traversal check narrowed to ".." segments). Added: incremental derivative mode (--incremental) that reuses outputs which fully decode at planned dimensions.
- Partial: F7 (--limit is now recorded in the report; refusing to write default catalog/report paths under --limit was skipped as out of proportion for a debug flag).
- Documented, no change: F9 (see Resolution under F9), F10 (downstream note).

Orientation decision input: an exiftool Orientation scan of the real archive is running separately; the orchestrator will decide on derivative regeneration versus incremental re-verification when it completes. The full import currently in flight predates these fixes, so its catalog needs re-emission either way; its derivative files only need regeneration where the scan finds Orientation 5-8 sources (an --incremental re-run heals exactly those automatically).
