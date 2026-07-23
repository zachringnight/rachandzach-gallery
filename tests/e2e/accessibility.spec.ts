import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { addGuestSession } from "./support/session";

/**
 * Accessibility (packet 12 / workstream A). WCAG 2.1 AA via axe-core,
 * against every page this environment can render for real without a live
 * database: the public site, the login screen (including its error states),
 * the 404 page, and the two guest pages that do no server-side data fetch
 * (/add-yours, /favorites). Gallery, lightbox, my-weekend, and admin-review
 * accessibility all need real content behind them and are test.fixme'd.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function auditViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations;
}

function describeViolations(violations: Awaited<ReturnType<typeof auditViolations>>) {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} -- ${v.nodes.length} node(s): ${v.nodes
          .map((n) => n.target.join(" "))
          .join("; ")}`,
    )
    .join("\n");
}

test.describe("WCAG AA scans on real, database-free pages", () => {
  const publicPages: Array<[string, string]> = [
    ["home", "/"],
    ["weekend", "/weekend"],
    ["login (enter)", "/enter"],
    ["login, invalid-password error state", "/enter?error=invalid"],
    ["login, rate-limited error state", "/enter?error=slow"],
    ["login, expired-link error state", "/enter?error=link"],
    ["404", "/definitely-not-a-real-route"],
  ];

  for (const [label, path] of publicPages) {
    test(`${label} (${path}) has no WCAG AA violations`, async ({ page }) => {
      await page.goto(path);
      const violations = await auditViolations(page);
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  }

  test.describe("guest pages (no server data required)", () => {
    test.beforeEach(async ({ context }) => {
      await addGuestSession(context);
    });

    test("add-yours (/add-yours) has no WCAG AA violations", async ({ page }) => {
      await page.goto("/add-yours");
      const violations = await auditViolations(page);
      expect(violations, describeViolations(violations)).toEqual([]);
    });

    test("favorites (empty state) (/favorites) has no WCAG AA violations", async ({
      page,
    }) => {
      // This test previously caught a page-crashing bug (see
      // access.spec.ts's "/favorites renders its real, database-free empty
      // state" test), now fixed upstream. With the page stable, it now
      // catches a real, currently-open color-contrast finding instead: the
      // empty-state copy ("You have not favorited any photos yet...", in
      // FavoritesGallery.tsx) uses `text-ink/60` (60% opacity ink on
      // cream), which computes to #7a766f on #f6f0e4, a 3.98:1 ratio --
      // below WCAG AA's 4.5:1 for normal-size text. Packet 09's file, out
      // of this packet's scope to fix; left failing deliberately.
      await page.goto("/favorites");
      const violations = await auditViolations(page);
      expect(violations, describeViolations(violations)).toEqual([]);
    });
  });
});

test.describe("keyboard access and visible focus", () => {
  test("a skip-to-content link is the first stop and jumps past the header", async ({
    context,
    page,
    browserName,
  }) => {
    // Real default Safari/WebKit behavior (which Playwright's WebKit build
    // faithfully reproduces, verified against this exact test): Tab only
    // moves through form controls, not links, unless the user has "Full
    // Keyboard Access" enabled system-wide -- a platform default outside
    // this app's control, not a bug. Chromium and Firefox both include
    // links in the default Tab order, so the assertion still runs there.
    test.skip(
      browserName === "webkit",
      "WebKit only tabs to form controls by default, matching real Safari's default (non-\"Full Keyboard Access\") behavior; this link-based skip target cannot be reached by a plain Tab press there.",
    );
    await addGuestSession(context);
    await page.goto("/add-yours");
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => ({
      text: document.activeElement?.textContent?.trim(),
      href: (document.activeElement as HTMLAnchorElement | null)?.getAttribute(
        "href",
      ),
    }));
    expect(focused.text).toBe("Skip to content");
    expect(focused.href).toBe("#gallery-main");
  });

  test("the login form is fully operable by keyboard alone", async ({
    page,
    browserName,
  }) => {
    await page.goto("/enter");
    await page.getByLabel("Password").focus();
    await expect(page.getByLabel("Password")).toBeFocused();
    await page.keyboard.press("Tab");
    if (browserName === "webkit") {
      // Same real Safari/WebKit default as above: buttons are not always in
      // the Tab order without "Full Keyboard Access." Confirm the button is
      // still independently reachable/activatable (it is a real <button
      // type="submit">, not hidden or disabled) rather than asserting a Tab
      // order WebKit does not implement by default.
      await expect(
        page.getByRole("button", { name: "Come on in" }),
      ).toBeEnabled();
      return;
    }
    await expect(page.getByRole("button", { name: "Come on in" })).toBeFocused();
  });

  test("focused interactive elements show a visible focus outline", async ({
    page,
  }) => {
    await page.goto("/enter");
    const passwordField = page.getByLabel("Password");
    await passwordField.focus();
    const outline = await passwordField.evaluate((el) => {
      const style = getComputedStyle(el, ":focus-visible");
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
    });
    // Not asserting a specific color/width (that is a design decision, not
    // an accessibility contract); asserting the browser is not suppressing
    // the outline entirely (outline-style: none with no visible substitute).
    expect(outline.outlineStyle).not.toBe("none");
  });
});

test.describe("reflow and reduced motion", () => {
  test("the home page reflows without horizontal scrolling at an effective 200% zoom", async ({
    page,
  }) => {
    // Standard WCAG 1.4.10 Reflow technique: halving the viewport is
    // equivalent to doubling zoom at a fixed viewport, and works
    // identically across browser engines (unlike the non-standard CSS
    // `zoom` property).
    await page.setViewportSize({ width: 720, height: 1024 });
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("the home page loads cleanly with prefers-reduced-motion: reduce", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const violations = await auditViolations(page);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});

test.describe("known gaps requiring a live database (out of scope here)", () => {
  test.fixme(
    "the lightbox dialog traps focus and restores it on close",
    async () => {
      // UNBLOCK: a live catalog so a real photo exists to open in
      // src/components/gallery/Lightbox.tsx; /photos itself 500s with no
      // database (see access.spec.ts).
    },
  );

  test.fixme("the gallery grid and lightbox have no WCAG AA violations", async () => {
    // UNBLOCK: same live catalog; real photo cards, alt text, and filter
    // controls all need real data to render.
  });

  test.fixme(
    "the admin review queue has no WCAG AA violations",
    async () => {
      // UNBLOCK: live Supabase project with Auth (see admin.spec.ts's
      // equivalent fixme) plus at least one real submitted batch to render.
    },
  );
});
