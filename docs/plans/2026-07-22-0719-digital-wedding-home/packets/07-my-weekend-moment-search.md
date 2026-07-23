# Task 07: My Weekend and Moment Search

**Wave:** 4
**Depends on:** 02, 03, 04, 06

## Objective

Add two high-value discovery modes. My Weekend gives a guest a no-account personal collection based on confirmed person tags. Moment Search finds scenes such as "sunset kiss," "champagne toast," or "people dancing" without performing face recognition.

## Files

- Create: src/app/(guest)/my-weekend/page.tsx
- Create: src/app/api/search/route.ts
- Create: src/components/personalization/MyWeekendSetup.tsx
- Create: src/components/personalization/MyWeekendGallery.tsx
- Create: src/components/search/MomentSearch.tsx
- Create: src/components/search/SearchExamples.tsx
- Create: src/lib/search/moment-search.ts
- Create: src/lib/search/query-embedding.ts
- Create: src/lib/personalization/my-weekend.ts
- Create: scripts/build-embeddings.py
- Create: scripts/requirements-search.txt
- Create: supabase/migrations/202607220003_moment_search.sql
- Test: tests/search/moment-search.test.ts
- Test: tests/personalization/my-weekend.test.ts

## Interfaces

- Consumes: GalleryPhotoRecord.imageDataHash and previewObjects from task 02.
- Consumes: photos, people, photo_people, photo_keywords, and createServerClient() from task 03.
- Consumes: requireGalleryAccess() from task 04.
- Consumes: getGalleryPage(input) from task 06.
- Produces table: photo_embeddings(photo_id uuid primary key, model text, model_version text, embedding vector(512), generated_at timestamptz).
- Produces RPC: search_gallery_moments(query_embedding vector(512), event_filter text, result_limit int) -> table(photo_id uuid, similarity float).
- Produces: MyWeekendPreference
  - personSlug: string
  - setAt: string
  - version: 1
- Produces: getMyWeekendPreference() -> MyWeekendPreference | null, client only.
- Produces: setMyWeekendPreference(personSlug: string) -> void, client only.
- Produces: searchMoments(input: { query: string; event: string | null; limit: number }) -> Promise<MomentSearchResult[]>.

## Privacy and model rules

- Do not use the existing face-recognition review models for site search.
- Do not generate or store face embeddings.
- Generate photo embeddings locally from approved display derivatives.
- Runtime text embedding must use the exact same CLIP model family and version as the local image job.
- The compatibility spike is done: read docs/plans/2026-07-22-0719-digital-wedding-home/spikes/clip-model.md and follow it. Pinned: openai/clip-vit-base-patch32 (Python, image side, uv-managed Python 3.12) and Xenova/clip-vit-base-patch32 (JS text side) at the revisions recorded in the note, L2-normalize both sides, run the 5-string cross-side parity check (cosine > 0.999) before ingesting embeddings.
- The text encoder runs in a Vercel Node route (inside src/app/api/search/route.ts via src/lib/search/query-embedding.ts), not a Supabase Edge Function.
- Do not send wedding images to a third-party AI service.
- Do not log query text. Log only success, latency bucket, and result count if analytics is enabled.
- If the embedding service is unavailable, fall back to confirmed keywords and event names.

## Steps

- [ ] Write My Weekend tests for select, persist, change person, invalid slug, and cleared local storage.
- [ ] Write search tests with a deterministic vector fixture, event filtering, low-similarity rejection, disabled flag behavior, and pending-photo isolation.
- [ ] Add pgvector and the photo_embeddings table in a separate reversible migration.
- [ ] Build a local Python job using the pinned 512-dimensional CLIP model from the spike note, on uv-managed Python 3.12 (system Python is 3.14; do not fight torch wheels there). Batch approved previews, checkpoint progress, and upsert by photo ID plus model version.
- [ ] Measure the Vercel Node text-encoder path: cold start, bundle size, and median latency before enabling production.
- [ ] Build the protected search route with input validation, 2 to 80 characters, maximum 40 results, and rate limiting.
- [ ] Build My Weekend setup with a searchable list of confirmed names. Store only the selected slug on that device.
- [ ] Group My Weekend results by event. Reuse the generic Slideshow from task 09 by passing the My Weekend photo list, and include favorites and download entry points from task 09. Task 09 ships Slideshow with no My Weekend import; the wiring lives here.
- [ ] Add approachable search examples based on known visual categories, not names.
- [ ] Keep momentSearch off in production if p95 query latency exceeds 1500 ms or the model license is unresolved.
- [ ] Report status. Do not enable production AI or upload images externally.

## Done-check

Run: npm run test -- tests/search/moment-search.test.ts tests/personalization/my-weekend.test.ts && uv run --python 3.12 scripts/build-embeddings.py --fixture tests/fixtures/search --verify

Expected: tests pass. Fixture image and text embeddings have dimension 512. Person names are absent from embeddings and request logs. Disabled search returns the keyword fallback or hidden UI, never an error page.

## Report

Report DONE_WITH_CONCERNS if the feature works but should remain beta for latency or relevance. Report BLOCKED for model-license or image-egress concerns.
