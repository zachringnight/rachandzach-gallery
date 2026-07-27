#!/usr/bin/env node
// Apply the tracked attendance roster and reviewed saved-face tags to the
// generated local catalog. This never opens or writes wedding originals.
//
// Default is read-only. Use --write to update src/generated/gallery-v2.json.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTrackedCatalogOverlays } from "./lib/catalog-overlays.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const catalogPath = join(repoRoot, "src", "generated", "gallery-v2.json");
const write = process.argv.includes("--write");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--write");
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown[0]}`);
  process.exit(2);
}

const catalog = JSON.parse(await fs.readFile(catalogPath, "utf8"));
const summary = await applyTrackedCatalogOverlays(catalog, repoRoot);
if (write) {
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
}
console.log(JSON.stringify({ mode: write ? "write" : "check", ...summary }, null, 2));
