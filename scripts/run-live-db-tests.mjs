// Runs vitest with .env.local loaded via @next/env (values are never
// printed), so the live-database suites actually execute instead of
// skipping. Usage:
//   node scripts/run-live-db-tests.mjs tests/admin/remove-person-live.test.ts
//   node scripts/run-live-db-tests.mjs tests/database/schema.test.ts
// Live suites create only namespaced rows and clean up after themselves,
// but they do run against whatever database the env points at; be sure
// that is intentional before running.
import pkg from "@next/env";
import { spawnSync } from "node:child_process";

const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd(), false);

if (!process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
}

const result = spawnSync(
  "npx",
  ["vitest", "run", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
