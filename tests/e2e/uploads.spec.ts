import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { addGuestSession } from "./support/session";
import { MAX_FILE_BYTES, MAX_FILES_PER_BATCH } from "../../src/lib/uploads/contracts";

/**
 * Guest uploads (packet 12 / workstream A).
 *
 * src/app/(guest)/add-yours/page.tsx does no server-side data fetch (it only
 * gates on the session, see its header comment), so with a minted guest
 * session this whole page is real and database-free. Everything UploadClient
 * validates BEFORE any network call -- magic-byte sniffing, size, and the
 * per-batch file cap (src/lib/uploads/validate-upload.ts /
 * UploadClient.addFiles) -- is exercised for real here, with no fixtures or
 * stubbing of the app's own logic.
 *
 * The moment a real network call is needed (POST /api/uploads/batches to
 * create a batch, POST /api/uploads/sign for a TUS target, the TUS transfer
 * itself, submit-for-review, and the receipt/status pages), the app requires
 * a live database. src/lib/uploads/http.ts's enforceUploadRateLimit fails
 * closed through the SAME rate-limit RPC as login (see
 * tests/e2e/access.spec.ts), so this suite proves that real, deterministic
 * failure once and test.fixme's the rest with the exact unblock note.
 */

const FIXTURES = path.join(__dirname, "..", "fixtures", "shared");

/**
 * The upload queue's own <ul><li> (src/components/uploads/UploadQueue.tsx)
 * is not the only list on the page: SiteHeader's nav is also a <ul><li>. The
 * queue lives under <main>, the nav under <header>, so scoping to "main ul
 * li" is what isolates it.
 */
function queueItems(page: Page) {
  return page.locator("main ul li");
}

/**
 * The app's own error paragraph is always `<p role="alert">`
 * (UploadClient.tsx). Next.js also renders its own empty `<div role="alert"
 * aria-live="assertive" id="__next-route-announcer__">` on every page for
 * screen-reader route-change announcements, so a bare `page.getByRole
 * ("alert")` is ambiguous (matches both). Scope to the app's own element.
 */
function appAlert(page: Page) {
  return page.locator('p[role="alert"]');
}

/** Minimal buffer that satisfies validateUploadFile's magic-byte sniff for
 *  JPEG (0xFF 0xD8 0xFF) without needing a real fixture file on disk. */
function tinyJpegBuffer(byteLength = 32): Buffer {
  const buf = Buffer.alloc(Math.max(byteLength, 3));
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
}

/**
 * A file over MAX_FILE_BYTES that still sniffs as a valid JPEG, so it is
 * rejected specifically for its SIZE, not its type. Playwright's
 * setInputFiles caps inline buffers at 50 MB, just under MAX_FILE_BYTES
 * (52,428,800 bytes), so this has to be a real temp file rather than an
 * in-memory buffer -- written to the OS temp dir at test time (never
 * committed, unlike the shared fixtures pack, which deliberately excludes
 * large binaries) and removed afterward.
 */
function writeOversizedJpegFile(): string {
  const filePath = path.join(os.tmpdir(), `rz-e2e-oversized-${Date.now()}.jpg`);
  const buf = Buffer.alloc(MAX_FILE_BYTES + 1024);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  fs.writeFileSync(filePath, buf);
  return filePath;
}

test.describe("add-yours: real, database-free client-side validation", () => {
  test.beforeEach(async ({ context, page }) => {
    await addGuestSession(context);
    await page.goto("/add-yours");
  });

  test("a visitor with no cookie reaches this page and is given a session", async ({
    browser,
  }) => {
    // Inverted on 2026-08-09: this asserted a redirect to /enter. Uploading
    // is open now, so what has to hold instead is that the proxy still hands
    // the visitor an identity -- without one their batch has no owner key.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/add-yours");
    expect(new URL(freshPage.url()).pathname).toBe("/add-yours");
    const cookies = await freshContext.cookies();
    expect(cookies.map((c) => c.name)).toContain("rz_gallery_session");
    await freshContext.close();
  });

  test("a valid synthetic photo is queued", async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(FIXTURES, "synthetic-1-tiny.jpg"));
    await expect(page.getByText("synthetic-1-tiny.jpg")).toBeVisible();
    await expect(page.getByText("Waiting")).toBeVisible();
    await expect(queueItems(page)).toHaveCount(1);
  });

  test("a non-image file is rejected client-side by magic bytes, not extension", async ({
    page,
  }) => {
    // fake.jpg is plain text bytes wearing a .jpg extension; the app must
    // sniff the real bytes, not trust the name.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(FIXTURES, "fake.jpg"));
    await expect(appAlert(page)).toContainText(
      'is not a JPEG, PNG, WebP, or HEIC photo, so it was skipped',
    );
    await expect(queueItems(page)).toHaveCount(0);
  });

  test("an SVG is rejected even though the OS picker's accept filter would normally hide it", async ({
    page,
  }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(FIXTURES, "tiny-svg.svg"));
    await expect(appAlert(page)).toContainText(
      "is not a JPEG, PNG, WebP, or HEIC photo",
    );
    await expect(queueItems(page)).toHaveCount(0);
  });

  test("a file over the 50 MB cap is rejected client-side before any upload starts", async ({
    page,
  }) => {
    const oversizedPath = writeOversizedJpegFile();
    try {
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(oversizedPath);
      await expect(appAlert(page)).toContainText("is larger than 50 MB");
      await expect(queueItems(page)).toHaveCount(0);
    } finally {
      fs.unlinkSync(oversizedPath);
    }
  });

  test("selecting the same file twice flags the second as a duplicate", async ({
    page,
  }) => {
    const fileInput = page.locator('input[type="file"]');
    const buffer = tinyJpegBuffer();
    await fileInput.setInputFiles({ name: "same.jpg", mimeType: "image/jpeg", buffer });
    await fileInput.setInputFiles({ name: "same.jpg", mimeType: "image/jpeg", buffer });
    await expect(queueItems(page)).toHaveCount(2);
    await expect(
      page.getByText(/looks like a duplicate of another photo/i),
    ).toBeVisible();
  });

  test(`the batch cap stops at ${MAX_FILES_PER_BATCH} files with a clear message`, async ({
    page,
  }) => {
    const fileInput = page.locator('input[type="file"]');
    const overCap = Array.from({ length: MAX_FILES_PER_BATCH + 1 }, (_, index) => ({
      name: `photo-${index}.jpg`,
      mimeType: "image/jpeg",
      buffer: tinyJpegBuffer(),
    }));
    await fileInput.setInputFiles(overCap);
    await expect(queueItems(page)).toHaveCount(MAX_FILES_PER_BATCH);
    await expect(appAlert(page)).toContainText(
      `You can upload up to ${MAX_FILES_PER_BATCH} photos at a time.`,
    );
  });

  test("starting an upload fails closed with no live database, and the form recovers", async ({
    page,
  }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(FIXTURES, "synthetic-1-tiny.jpg"));
    await page.getByRole("button", { name: /upload 1 photos/i }).click();

    // POST /api/uploads/batches -> enforceUploadRateLimit -> the same
    // rate-limit RPC as login. consumeRateLimit() (src/lib/auth/rate-limit.ts)
    // catches the network failure internally and returns false rather than
    // throwing, so enforceUploadRateLimit's own catch block (which would say
    // "Upload rate limiting is unavailable.") never fires -- the request is
    // just treated as rate-limit-exhausted, the same fail-closed outcome as
    // a real burst of requests would get. Verified against the running
    // server, not assumed.
    await expect(appAlert(page)).toContainText(
      "Too many upload requests. Please wait a moment and retry.",
    );
    // Phase reverts to "collecting" on failure: the primary action is
    // available again rather than the UI getting stuck mid-upload.
    await expect(
      page.getByRole("button", { name: /upload 1 photos/i }),
    ).toBeVisible();
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme(
    "a queued photo actually transfers over resumable TUS to Storage",
    async () => {
      // UNBLOCK: a live Supabase project so POST /api/uploads/batches (and
      // then /api/uploads/sign) succeed and return a real signed TUS
      // endpoint/token; no Docker/local Postgres in this environment.
    },
  );

  test.fixme("pause, resume, and retry act on an in-flight TUS transfer", async () => {
    // UNBLOCK: same live project as above; pause/resume/retry all operate on
    // the tus.Upload instance created only after a real signed target comes
    // back from POST /api/uploads/sign.
  });

  test.fixme(
    "submitting a batch produces a receipt and a working status page",
    async () => {
      // UNBLOCK: same live project; POST /api/uploads/batches/:id/submit and
      // src/app/(guest)/submissions/[batchId]/page.tsx both read real rows.
    },
  );

  test.fixme(
    "a truncated JPEG (valid header, no EOI) is rejected at submit time",
    async () => {
      // Client-side validation only sniffs magic bytes (see
      // src/lib/uploads/validate-upload.ts's header comment), so
      // tests/fixtures/shared/truncated.jpg is NOT rejected client-side --
      // full decode happens server-side at submit. UNBLOCK: live database so
      // the submit route and its decode step actually run.
    },
  );

  test.fixme(
    "an incomplete batch (some items never finish uploading) surfaces correctly",
    async () => {
      // UNBLOCK: live project; requires real per-item upload state in
      // rachandzach_upload_items.
    },
  );
});
