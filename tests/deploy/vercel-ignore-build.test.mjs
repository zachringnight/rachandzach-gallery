// Unit coverage for scripts/vercel-ignore-build.mjs (packet 12).
//
// Exercises the script the way Vercel does: spawn a fresh node process with a
// controlled env and assert on the exit code. Vercel ignoreCommand semantics:
// exit 1 means BUILD, exit 0 means SKIP.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const EXIT_BUILD = 1;
const EXIT_SKIP = 0;

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/vercel-ignore-build.mjs",
);

/**
 * Run the guard script in a child process with a controlled env.
 * Pass `undefined` to leave VERCEL_GIT_COMMIT_REF entirely unset.
 */
function runGuard(ref) {
  const env = { ...process.env };
  delete env.VERCEL_GIT_COMMIT_REF;
  if (ref !== undefined) {
    env.VERCEL_GIT_COMMIT_REF = ref;
  }
  const result = spawnSync(process.execPath, [scriptPath], {
    env,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("vercel-ignore-build guard", () => {
  describe("branches that must build (exit 1)", () => {
    it.each([
      ["main"],
      ["staging"],
      ["preview/launch-candidate"],
      ["preview/wip-promoted"],
      ["preview/nested/branch"],
    ])("builds %s", (ref) => {
      const run = runGuard(ref);
      expect(run.exitCode).toBe(EXIT_BUILD);
      expect(run.stdout).toContain("building");
    });
  });

  describe("branches that must skip (exit 0)", () => {
    it.each([
      ["dependabot/npm_and_yarn/next-16.2.10"],
      ["codex/experiment-1"],
      ["claude/wave-1-agent"],
      ["wip/half-finished-idea"],
    ])("skips ignored prefix %s", (ref) => {
      const run = runGuard(ref);
      expect(run.exitCode).toBe(EXIT_SKIP);
      expect(run.stdout).toContain("skipping");
    });

    it.each([
      ["feature/gallery-lightbox"],
      ["master"],
      ["develop"],
      ["some-random-branch"],
      ["preview"],
      ["preview-not-a-prefix"],
      ["mainline"],
      ["staging-2"],
      ["Main"],
      ["not-main"],
    ])("skips every other branch: %s", (ref) => {
      const run = runGuard(ref);
      expect(run.exitCode).toBe(EXIT_SKIP);
      expect(run.stdout).toContain("skipping");
    });
  });

  describe("missing or empty ref", () => {
    it("skips when VERCEL_GIT_COMMIT_REF is unset and logs the reason", () => {
      const run = runGuard(undefined);
      expect(run.exitCode).toBe(EXIT_SKIP);
      expect(run.stdout).toContain("missing or empty");
    });

    it("skips when VERCEL_GIT_COMMIT_REF is an empty string and logs the reason", () => {
      const run = runGuard("");
      expect(run.exitCode).toBe(EXIT_SKIP);
      expect(run.stdout).toContain("missing or empty");
    });

    it("skips when VERCEL_GIT_COMMIT_REF is only whitespace and logs the reason", () => {
      const run = runGuard("   ");
      expect(run.exitCode).toBe(EXIT_SKIP);
      expect(run.stdout).toContain("missing or empty");
    });
  });

  describe("log output", () => {
    it("always states the decision with the exit-code meaning", () => {
      const build = runGuard("main");
      expect(build.stdout).toContain("(exit 1: build)");

      const skip = runGuard("wip/anything");
      expect(skip.stdout).toContain("(exit 0: skip)");
    });
  });
});
