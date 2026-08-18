import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/**",
    "metadata/**",
    "models/**",
    // uv-managed Python venv for the CLIP embedding job; contains vendored
    // third-party JS (e.g. torch's model_dump viewer) that must never lint.
    ".venv-search/**",
    // uv-managed Python venv for the face-recognition pipeline (Round Two);
    // matplotlib and friends vendor JS that must never lint either.
    ".venv-faces/**",
    // Claude Design session artifacts (generated bundles + vendored JS,
    // dropped into the worktree by an external design session 2026-07-23);
    // never lint, never commit (.gitignore mirrors this).
    "ds-bundle/**",
    ".design-sync/**",
    ".ds-sync/**",
    // Playwright run artifacts (HTML report bundles a minified trace viewer
    // that explodes lint output; test-results holds failure screenshots).
    "playwright-report/**",
    "test-results/**",
    // Coding-agent git worktrees. These are full checkouts of this repo
    // living inside it, so linting them reports every finding twice (and
    // reports a sibling branch's in-progress code as if it were ours).
    ".claude/worktrees/**",
    // Session scratch and handoff buffers written by the remember plugin.
    // Gitignored, machine-written, and sometimes TypeScript, so lint walks
    // in and reports on a file no one here wrote or maintains.
    ".remember/**",
  ]),
]);
