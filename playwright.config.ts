import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_PORT, syntheticServerEnv } from "./tests/e2e/support/env";

/**
 * Packet 12 / workstream A: the bounded Playwright e2e suite.
 *
 * `npx playwright test tests/e2e --project=chromium` is the exact command
 * the packet's COMMON section pins as "the bounded suite," so the primary
 * project below MUST be named `chromium`.
 *
 * This config's webServer runs `npm run start` (next start) against an
 * ALREADY-BUILT .next directory -- `npm run build` is run once, separately,
 * before this suite (see docs/HANDOFF_CURRENT.md for the exact command);
 * this file never rebuilds. The SYNTHETIC BUILD ENV
 * (tests/e2e/support/env.ts) is what lets `next start` boot at all with no
 * real Supabase project configured: build succeeds without secrets, and
 * every DB-backed request then fails closed at runtime, on purpose. Several
 * specs assert on exactly that fail-closed behavior; see each spec file's
 * header comment for which flows are exercised for real versus
 * `test.fixme`'d pending a live database.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Visual baselines are generated on this Mac (every snapshot is
  // *-darwin.png). A Linux CI runner has no matching snapshots and
  // Playwright fails on missing snapshots in CI rather than writing them.
  // Skip pixel comparisons in CI only: the visual spec's flows still run
  // there; enforcement stays local until Linux baselines exist.
  ignoreSnapshots: !!process.env.CI,
  // 1 retry locally too: a small number of tests navigate through a real
  // POST -> redirect -> render cycle against a single `next start` process,
  // and this sandboxed environment occasionally drops one such navigation
  // (observed as Chromium's own "This page couldn't load" interstitial, not
  // an application error -- a direct 20-concurrent-request stress test
  // against the same server showed no server-side fault). A genuine
  // application bug fails the same way on retry; this only smooths over
  // that specific infra flake.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Was 0.02, which was too loose to be a gate on these pages. Rewriting
    // the favorites empty-state paragraph and adding two buttons moved only
    // 1.42% of pixels on the full-page 1440x1066 capture -- most of the
    // archive's surfaces are quiet cream, so a real content change barely
    // registers as a ratio. It passed, and webkit's baseline sat 1% stale
    // without anyone noticing. 0.001 still absorbs antialiasing (verified
    // stable over repeated full runs across all four projects) while
    // catching changes of that size.
    toHaveScreenshot: { maxDiffPixelRatio: 0.001 },
  },
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },

  // Responsive coverage required by the packet: 1440x1024 and 1024x768
  // desktop breakpoints plus a 390x844 mobile viewport, across Chromium and
  // WebKit engines. Every project runs the same tests/e2e directory; visual
  // baselines (visual.spec.ts) are what turn this project matrix into
  // screenshots at all three required sizes, with no manual per-test resize
  // loop needed.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "tablet-1024",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } },
    },
    {
      name: "mobile-390",
      use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } },
    },
  ],

  webServer: {
    command: `npm run start -- -p ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: syntheticServerEnv(),
  },
});
