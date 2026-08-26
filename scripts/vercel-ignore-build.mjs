import { spawnSync } from "node:child_process";

const base = process.env.VERCEL_GIT_PREVIOUS_SHA;
const runtimePaths = [
  "src",
  "public",
  "metadata",
  "scripts",
  "supabase",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
  "vercel.json",
];

// Exit 0 to skip the build. Exit 1 to build.
if (!base || !/^[0-9a-f]{7,40}$/i.test(base)) process.exit(1);

const exists = spawnSync("git", ["cat-file", "-e", `${base}^{commit}`], {
  stdio: "ignore",
});
if (exists.status !== 0) process.exit(1);

const diff = spawnSync("git", ["diff", "--quiet", base, "HEAD", "--", ...runtimePaths], {
  stdio: "ignore",
});

if (diff.status === 0) process.exit(0);
process.exit(1);
