# Task 12: Production QA and handoff

**Wave:** 6
**Depends on:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 13

## Objective

Integrate the build, prove privacy and original integrity, measure the full catalog, restrict preview builds, and create a clean approval handoff. Do not publish.

## Files

- Create: tests/e2e/access.spec.ts
- Create: tests/e2e/gallery.spec.ts
- Create: tests/e2e/uploads.spec.ts
- Create: tests/e2e/downloads.spec.ts
- Create: tests/e2e/admin.spec.ts
- Create: tests/e2e/accessibility.spec.ts
- Create: tests/e2e/visual.spec.ts
- Create: scripts/verify-original-integrity.mjs
- Create: scripts/verify-gallery-catalog.mjs
- Create: scripts/estimate-storage-egress.mjs
- Create: scripts/vercel-ignore-build.mjs
- Create: vercel.json
- Create: .github/workflows/ci.yml
- Create: docs/0719_Architecture_v1.md
- Create: docs/0719_Content_Needed_v1.md
- Create: docs/0719_Launch_Checklist_v1.md
- Create: docs/0719_Privacy_Operations_v1.md
- Create: docs/HANDOFF_CURRENT.md
- Modify: README.md

## Interfaces

- Consumes every public interface named in tasks 01 through 11 and 13.
- Produces CI command: npm run verify.
- Produces integrity command: npm run verify:originals.
- Produces catalog command: npm run verify:catalog.
- Produces preview-build rule:
  - Build main.
  - Build staging.
  - Build branches beginning preview/.
  - Skip dependabot/, codex/, claude/, wip/, and every other branch unless explicitly promoted.
- Produces handoff artifacts with current test results, known concerns, required secrets, missing content, cost estimate, and no-publish status.

## Acceptance matrix

- Catalog: current clean-master count reconciles with database count and every approved photo has an existing original object.
- Integrity: SAMPLED verification (default 100 photos) compares local file SHA-256 with file_sha256 and remote object size/sha metadata with the catalog, zero mismatches in the sample. Full-archive mode exists behind an explicit --full flag for launch day only; never download objects back from storage to compare (upload-time re-hashing plus remote metadata already prove identity).
- Discovery: event, person, orientation, source, favorites, My Weekend, URL deep links, and pagination work.
- Search: beta relevance set passes or the feature remains disabled.
- Downloads: individual original and 50-item streamed ZIP work without Vercel carrying media bytes.
- Uploads: pause, resume, retry, duplicate, invalid type, over-size, incomplete batch, and receipt flows work.
- Moderation: admin-only access, approve, partial approve, reject, retry, metadata edit, audit, and visibility isolation work.
- Responsive: 1440 by 1024, 1024 by 768, and 390 by 844.
- Accessibility: keyboard-only, visible focus, dialog trapping, labels, alt text, 200 percent zoom, reduced motion, and WCAG AA contrast.
- Performance: no layout shift from image loading, virtualized full-catalog scrolling, and mobile Lighthouse targets of at least 90 accessibility and 85 performance on a representative protected page.
- Privacy: no person names or signed media URLs in analytics, sitemap, robots output, public HTML, or logs.

## Steps

- [ ] Add npm run verify to execute typecheck, lint, unit tests, build, and the bounded Playwright suite.
- [ ] Build end-to-end fixtures with synthetic images and synthetic people. Never use real guest emails.
- [ ] Add browser coverage for current Chrome, Safari/WebKit, and mobile viewport behavior.
- [ ] Run the catalog verification against the clean master in read-only mode.
- [ ] Run the SAMPLED source-versus-storage check (local sha256 of sampled files vs catalog, catalog vs remote object metadata; no object downloads). The full-archive flag is a manual launch-day option, not part of automated verification; three prior layers (import hashing, pre-upload re-hash, post-sync metadata sweep) already cover identity.
- [ ] Prove pending and rejected objects are inaccessible from anonymous, guest, and public routes.
- [ ] Prove protected page HTML and API errors do not leak private object paths.
- [ ] Capture visual baselines at all three target sizes for home, gallery, lightbox, upload, receipt, and admin review.
- [ ] Write a storage and egress estimator that accepts current plan rates as inputs. Do not hardcode prices as permanent truth. Model preview egress under hourly signed URL rotation, which busts browser cache per rotation, and include a scenario with a longer preview TTL.
- [ ] Configure immutable preview headers and no-store responses for signed URL and auth endpoints.
- [ ] Implement the Vercel ignored-build script. Vercel exit code 1 means build and 0 means skip. Add unit coverage for branch names.
- [ ] Document that the current folder is not yet a Git repository. Creating a remote, connecting Vercel, and deploying are separate approval steps.
- [ ] List missing playlist, marathon, photographer credit, hero approval, domain, Supabase project, password, sender domain, and retention decisions in 0719_Content_Needed_v1.md.
- [ ] Run a local production build and serve it for final browser QA.
- [ ] Assemble HANDOFF_CURRENT.md with packet status, exact commands, screenshots, performance numbers, schema state, and unresolved eyeball items.
- [ ] Stop. Do not initialize a remote, connect cloud resources, upload real media, send email, or deploy.

## Done-check

Run: npm run verify && npm run verify:catalog && npm run verify:originals

Expected: all automated checks pass, the current catalog count is reconciled, and original mismatches equal zero. HANDOFF_CURRENT.md states NOT DEPLOYED and lists every remaining human approval.

## Report

Report one final status per packet and an integrated summary. Offer only these next actions: approve a private preview, revise, keep local, or discard. Public launch always requires a separate explicit approval.
