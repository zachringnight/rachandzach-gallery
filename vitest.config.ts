import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const alias = { "@": `${rootDir}src` };

// Playwright owns tests/e2e; vitest must never pick those up.
const sharedExclude = ["**/node_modules/**", "tests/e2e/**"];

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
        },
      },
    ],
  },
});
