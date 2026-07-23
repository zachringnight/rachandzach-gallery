# Task 10: Moderation and notifications

**Wave:** 4
**Depends on:** 03, 04, 08

## Objective

Give wedding@rachandzach.com a safe review queue for guest submissions. Approval creates cataloged display derivatives and makes selected photos visible. Every action is idempotent and auditable.

## Files

- Create: src/app/admin/layout.tsx
- Create: src/app/admin/review/page.tsx
- Create: src/app/admin/review/[batchId]/page.tsx
- Create: src/app/api/admin/batches/route.ts
- Create: src/app/api/admin/batches/[batchId]/approve/route.ts
- Create: src/app/api/admin/batches/[batchId]/reject/route.ts
- Create: src/app/api/admin/items/[itemId]/metadata/route.ts
- Create: src/components/admin/ReviewQueue.tsx
- Create: src/components/admin/BatchReviewer.tsx
- Create: src/components/admin/MetadataEditor.tsx
- Create: src/lib/moderation/state-machine.ts
- Create: src/lib/moderation/process-approved-photo.ts
- Create: src/lib/moderation/audit.ts
- Create: src/lib/notifications/resend.ts
- Create: src/emails/NewUploadBatch.tsx
- Create: src/emails/UploadDecision.tsx
- Test: tests/moderation/state-machine.test.ts
- Test: tests/moderation/visibility.test.ts
- Test: tests/notifications/idempotency.test.ts

## Interfaces

- Consumes: upload_batches, upload_items, moderation_actions, notification_log, photos, photo_people, and storage clients from task 03.
- Consumes: requireAdmin() from task 04.
- Consumes: upload states and validation results from task 08.
- Produces: ModerationDecision
  - itemId: string
  - action: "approve" | "reject"
  - eventSlug: string | null
  - peopleSlugs: string[]
  - keywords: string[]
  - noteApproved: boolean
  - rejectionReason: string | null
- Produces: transitionUploadItem(itemId, decision, actor) -> Promise<UploadItemRow>.
- Produces: processApprovedPhoto(itemId: string) -> Promise<{ photoId: string; created: boolean }>.
- Produces: notifyNewBatch(batchId: string) -> Promise<{ sent: boolean; providerId: string | null }>.
- Produces: notifyUploadDecision(batchId: string) -> Promise<{ sent: boolean; providerId: string | null }>.

## State rules

- draft can move to uploading or expired.
- uploading can move to submitted or expired.
- submitted items can move to approved or rejected.
- approved and rejected are terminal through normal UI.
- Reversal requires an explicit admin restore action and a new moderation audit record.
- A batch is approved, partially_approved, or rejected only after all items are terminal.
- Copying media, creating derivatives, inserting catalog rows, and setting visibility must be retry-safe.

## Steps

- [ ] Write state-machine tests for legal transitions, illegal transitions, retries, partial approval, and two simultaneous admin requests.
- [ ] Write visibility tests proving no catalog row becomes guest-visible before the approved asset and previews exist.
- [ ] Write notification tests proving a batch email is sent at most once per event through a stable idempotency key.
- [ ] Build a queue sorted by submitted time with counts, duplicate flags, validation state, and contact information.
- [ ] Build a focused batch reviewer with large previews, accept, reject, select all, event assignment, confirmed-person tags, keywords, and note approval.
- [ ] Preserve the submitted original in private storage. Create stripped display derivatives before visibility.
- [ ] HEIC approvals: stock sharp binaries do not decode HEIC. Decode HEIC to RGB via a wasm libheif path (for example heic-decode), then pipe into sharp for derivatives. If decode fails, surface a moderation error; never approve without a derivative.
- [ ] Move or copy approved media into guest-approved with new content-hashed object names. Never overwrite.
- [ ] Insert photos and metadata only after derivative success. Use compensating cleanup for a failed multi-system step.
- [ ] Record before and after JSON for every metadata or moderation change.
- [ ] Render the batch's notification_log history (kind, status, created_at, provider id) inside BatchReviewer so admin can see what was sent.
- [ ] Send one NewUploadBatch email to wedding@rachandzach.com only when a complete batch enters submitted.
- [ ] If the guest supplied an email, send one decision receipt after the batch becomes terminal. Do not expose internal rejection notes.
- [ ] Keep Resend disabled unless RESEND_API_KEY, verified sender, and explicit send approval exist.
- [ ] Add a recoverable cleanup view for rejected items older than 30 days. Do not auto-delete in this task.
- [ ] Report status. Never send a real email in tests.

## Done-check

Run: npm run test -- tests/moderation/state-machine.test.ts tests/moderation/visibility.test.ts tests/notifications/idempotency.test.ts && npm run build

Expected: tests and build pass. Retrying approval creates one photo, one set of previews, and one audit trail. Pending and rejected assets remain invisible. Email test transport records one message per idempotency key.

## Report

Report DONE_WITH_CONCERNS until the real sender domain and retention policy receive Zach's end approval. Any visibility leak is BLOCKED.
