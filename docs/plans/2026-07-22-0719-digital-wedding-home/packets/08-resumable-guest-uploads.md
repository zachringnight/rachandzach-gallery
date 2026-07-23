# Task 08: Resumable guest uploads

**Wave:** 3
**Depends on:** 01, 03, 04

## Objective

Let invited guests submit full-resolution photos directly to private quarantine storage. Give them reliable progress and a receipt without allowing any upload to appear before review by wedding@rachandzach.com.

## Files

- Create: src/app/(guest)/add-yours/page.tsx
- Create: src/app/(guest)/add-yours/UploadClient.tsx
- Create: src/app/api/uploads/batches/route.ts
- Create: src/app/api/uploads/batches/[batchId]/submit/route.ts
- Create: src/app/api/uploads/batches/[batchId]/status/route.ts
- Create: src/app/api/uploads/sign/route.ts
- Create: src/components/uploads/UploadDropzone.tsx
- Create: src/components/uploads/UploadQueue.tsx
- Create: src/components/uploads/UploadReceipt.tsx
- Create: src/lib/uploads/contracts.ts
- Create: src/lib/uploads/create-batch.ts
- Create: src/lib/uploads/sign-upload.ts
- Create: src/lib/uploads/validate-upload.ts
- Test: tests/uploads/contracts.test.ts
- Test: tests/uploads/status-isolation.test.ts

## Interfaces

- Consumes: upload_batches, upload_items, createServerClient(), and createAdminClient() from task 03.
- Consumes: requireGalleryAccess() and rate limiting from task 04.
- Produces: CreateUploadBatchInput
  - displayName: string | null
  - email: string | null
  - note: string | null
  - itemCount: number
- Produces: UploadBatchReceipt
  - batchId: string
  - receiptToken: string
  - expiresAt: string
- Produces: SignedUploadTarget
  - itemId: string
  - objectPath: string
  - signedToken: string
  - tusEndpoint: string
  - expiresAt: string
- Produces: createUploadBatch(input, guestSession) -> Promise<UploadBatchReceipt>.
- Produces: createSignedUploadTarget(batchId, fileMetadata) -> Promise<SignedUploadTarget>.
- Produces: getUploadStatus(batchId, receiptToken) -> Promise<PublicUploadStatus>.
- Produces states: draft, uploading, submitted, approved, partially_approved, rejected, expired.

## Validation rules

- Allow JPEG, PNG, WebP, and HEIC only.
- Reject SVG, archives, documents, executables, video, and MIME or magic-byte mismatch.
- Maximum 50 files per batch and 50 MB per file.
- Normalize display filenames for UI. Never use a guest filename as an object path.
- Object path: pending/{batchId}/{itemId}/{randomNonce}
- Never upsert guest objects.
- Hash receipt tokens before database storage.
- Pending objects remain inaccessible to the submitting guest after upload. Status returns state and counts only.

## Steps

- [ ] Spike before UI: verify the current Supabase TUS authorization model against live docs. Signed upload URLs are single-shot PUTs, not TUS. Choose and record one path: (a) a short-lived server-minted storage token compatible with TUS if the platform supports it, (b) a storage RLS insert policy scoped to guest-pending plus server-issued object paths and rate limits, or (c) per-file signed PUT with client retry, dropping resumability. The chosen path goes in the packet report.
- [ ] Write contract tests for valid files, extensions, magic bytes, size, batch count, malformed metadata, and expired receipt tokens.
- [ ] Write isolation tests proving pending paths cannot be listed or read by guest or anonymous clients.
- [ ] Create the batch and item rows before issuing signed upload tokens.
- [ ] Use Uppy with TUS against the direct project storage hostname. Enable pause, resume, retry, progress, and duplicate selection warnings.
- [ ] Calculate a browser SHA-256 when practical. Treat it as a hint until server verification after upload.
- [ ] Validate uploaded bytes with a decoder job before a batch can enter submitted. HEIC validation decodes via wasm libheif; stock sharp cannot read HEIC.
- [ ] Strip GPS and device-identifying EXIF only from public display derivatives. Keep the private submitted original unchanged.
- [ ] Detect exact duplicate hashes against approved originals and within the batch. Mark them duplicate for admin review, not automatic deletion.
- [ ] Let the guest add one optional batch note. Hold it for moderation with the photos.
- [ ] Issue an opaque receipt code and local status URL. Email is optional and handled by packet 10.
- [ ] Add clear language that uploads are reviewed before appearing.
- [ ] Report status. Do not notify anyone or upload real photos during tests.

## Done-check

Run: npm run test -- tests/uploads/contracts.test.ts tests/uploads/status-isolation.test.ts && npm run build

Expected: tests and build pass. A simulated interrupted upload resumes. Invalid files are rejected before signing. A submitted fixture remains absent from every gallery query.

## Report

Report DONE, DONE_WITH_CONCERNS, BLOCKED, or NEEDS_CONTEXT. Browser-specific HEIC limitations belong in DONE_WITH_CONCERNS with the fallback behavior.
