import { test, expect, type Page } from "@playwright/test";
import { addGuestSession } from "./support/session";

/**
 * Visual baselines (packet 12 / workstream A).
 *
 * Captured once per Playwright project, and this config's four projects
 * (chromium, webkit, tablet-1024, mobile-390 -- see playwright.config.ts)
 * cover all three sizes the packet requires (1440x1024, 1024x768, 390x844)
 * without any manual per-test viewport loop.
 *
 * Only pages that render for real with no live database are covered here;
 * gallery, lightbox, upload-in-progress, receipt, and admin-review all need
 * real content behind them and are test.fixme'd at the bottom.
 *
 * Note for whoever reviews these baselines: home.png includes real wedding
 * photography (public/story/*.jpg, dev picks pending
 * Zach's visual approval per src/content/story-photos.ts). They are
 * generated here purely mechanically for pixel-diff regression tracking --
 * this suite never opens or inspects it, only Playwright's own pass/fail
 * comparison does. If that is not wanted as a stored baseline, delete
 * tests/e2e/visual.spec.ts-snapshots/home-* and skip that case.
 */

test.use({ colorScheme: "light" });

async function prepareVisualCapture(page: Page): Promise<void> {
  await page.locator("[data-reveal]").evaluateAll((elements) => {
    for (const element of elements) {
      (element as HTMLElement).dataset.reveal = "in";
    }
  });
  await page.locator("img").evaluateAll(async (images) => {
    for (const image of images) {
      (image as HTMLImageElement).loading = "eager";
    }
    await Promise.all(
      images.map((image) => (image as HTMLImageElement).decode().catch(() => undefined)),
    );
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe("public pages", () => {
  test("home", async ({ page }) => {
    await page.goto("/");
    await prepareVisualCapture(page);
    await expect(page).toHaveScreenshot("home.png", {
      fullPage: true,
      animations: "disabled",
      timeout: 15_000,
    });
  });

  test("login (enter)", async ({ page }) => {
    await page.goto("/enter");
    await prepareVisualCapture(page);
    await expect(page).toHaveScreenshot("enter.png", { animations: "disabled" });
  });

  test("login, invalid-password error state", async ({ page }) => {
    await page.goto("/enter?error=invalid");
    await prepareVisualCapture(page);
    await expect(page).toHaveScreenshot("enter-error-invalid.png", {
      animations: "disabled",
    });
  });

  test("404", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await prepareVisualCapture(page);
    await expect(page).toHaveScreenshot("not-found.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("guest pages (no server data required)", () => {
  test.beforeEach(async ({ context }) => {
    await addGuestSession(context);
  });

  test("add-yours (empty upload form)", async ({ page }) => {
    await page.goto("/add-yours");
    await prepareVisualCapture(page);
    await expect(page).toHaveScreenshot("add-yours.png", {
      fullPage: true,
      animations: "disabled",
    });
  });

  test("favorites (empty state)", async ({ page }) => {
    // A real mid-session React crash on this page (see access.spec.ts's
    // "/favorites renders its real, database-free empty state" test) was
    // fixed upstream before this baseline was captured, so this is the
    // correct, stable empty state, not the crash.
    await page.goto("/favorites");
    await prepareVisualCapture(page);
    await expect(page).toHaveScreenshot("favorites-empty.png", {
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme("gallery grid at all three sizes", async () => {
    // UNBLOCK: a live Supabase project with the catalog imported; /photos
    // 500s with no database (see access.spec.ts).
  });

  test.fixme("lightbox open over the gallery grid", async () => {
    // UNBLOCK: same live catalog, plus a real photo id to open.
  });

  test.fixme("upload queue mid-progress (uploading / paused / error rows)", async () => {
    // UNBLOCK: live database so POST /api/uploads/batches succeeds and a
    // real TUS transfer can be put into each visual state.
  });

  test.fixme("upload receipt page", async () => {
    // UNBLOCK: live database so a batch can actually be submitted; see
    // uploads.spec.ts's equivalent fixme.
  });

  test.fixme("admin review queue with real submitted batches", async () => {
    // UNBLOCK: live Supabase project with Auth (magic link) plus at least
    // one real submitted batch; see admin.spec.ts's equivalent fixme.
  });
});
