#!/usr/bin/env node
/**
 * Vercel ignored-build guard (packet 12).
 *
 * Decides whether Vercel should build the current commit, based on
 * VERCEL_GIT_COMMIT_REF. Wired up via "ignoreCommand" in vercel.json.
 *
 * Vercel ignoreCommand semantics (intentionally inverted from shell habits):
 *   exit 1  -> BUILD proceeds
 *   exit 0  -> build is SKIPPED
 *
 * Policy:
 *   Build: main, staging, codex/wedding-premium-overhaul, and preview/*
 *   Skip:  every other dependabot/, codex/, claude/, wip/, or unlisted branch
 *   Skip:  missing or empty ref (logged so the Vercel build log explains why)
 */

import { pathToFileURL } from "node:url";

const EXIT_BUILD = 1;
const EXIT_SKIP = 0;

const BUILD_BRANCHES = new Set([
  "main",
  "staging",
  "codex/wedding-premium-overhaul",
]);
const BUILD_PREFIXES = ["preview/"];
const SKIP_PREFIXES = ["dependabot/", "codex/", "claude/", "wip/"];

/**
 * @param {string | undefined} rawRef
 * @returns {{ exitCode: number, reason: string }}
 */
export function decide(rawRef) {
  const ref = typeof rawRef === "string" ? rawRef.trim() : "";

  if (ref === "") {
    return {
      exitCode: EXIT_SKIP,
      reason: "VERCEL_GIT_COMMIT_REF is missing or empty; skipping build.",
    };
  }

  if (BUILD_BRANCHES.has(ref)) {
    return {
      exitCode: EXIT_BUILD,
      reason: `Branch "${ref}" is a deploy branch; building.`,
    };
  }

  for (const prefix of BUILD_PREFIXES) {
    if (ref.startsWith(prefix)) {
      return {
        exitCode: EXIT_BUILD,
        reason: `Branch "${ref}" matches build prefix "${prefix}"; building.`,
      };
    }
  }

  for (const prefix of SKIP_PREFIXES) {
    if (ref.startsWith(prefix)) {
      return {
        exitCode: EXIT_SKIP,
        reason: `Branch "${ref}" matches ignored prefix "${prefix}"; skipping build.`,
      };
    }
  }

  return {
    exitCode: EXIT_SKIP,
    reason: `Branch "${ref}" is not on the build allowlist (main, staging, codex/wedding-premium-overhaul, preview/*); skipping build.`,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const decision = decide(process.env.VERCEL_GIT_COMMIT_REF);
  const verdict = decision.exitCode === EXIT_BUILD ? "build" : "skip";
  console.log(`[vercel-ignore-build] ${decision.reason} (exit ${decision.exitCode}: ${verdict})`);
  process.exit(decision.exitCode);
}
