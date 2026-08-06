import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const alias = { "@": `${rootDir}src` };

// Playwright owns tests/e2e; vitest must never pick those up.
const sharedExclude = ["**/node_modules/**", "tests/e2e/**"];

/**
 * Vitest's default is 5s, which this suite outgrew. On a machine also running
 * an image pipeline, three consecutive runs failed 1, 2 and 11 tests, every
 * failure a timeout, every one passing in isolation, and a quiet machine
 * passing all 1,139. The slowest cases are legitimately slow rather than
 * broken: the download tests drive 180 photographs through four sequential
 * signing round trips and a mocked ZIP stream, each step re-rendering React.
 *
 * 20s is chosen to be far above what a loaded machine needs and far below
 * what a genuine hang costs. A test that never settles still fails, 15s
 * later; a test that is merely competing for CPU no longer reports a
 * failure that is not there. Widening it is deliberate: a suite that cries
 * wolf under load teaches people to re-run until green, which is how a real
 * failure eventually slips past.
 */
const TEST_TIMEOUT_MS = 20_000;

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts", "tests/**/*.test.mjs"],
          exclude: sharedExclude,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["tests/**/*.test.tsx"],
          exclude: sharedExclude,
          testTimeout: TEST_TIMEOUT_MS,
          hookTimeout: TEST_TIMEOUT_MS,
        },
      },
    ],
  },
});
