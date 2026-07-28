#!/usr/bin/env node
/**
 * Build a static copy of the face-naming page, for inspecting the queue
 * without starting a session.
 *
 *   node scripts/build-naming-tool.mjs
 *
 * The naming session itself is `npm run tag` (scripts/tag-faces.mjs). That one
 * serves the same page over loopback and writes each answer to the tracked
 * decision records. The static page here has nowhere to save to, so it is for
 * looking at the queue, not for answering it.
 *
 * Everything written lands under gitignored `metadata/identity-review/`.
 * Read-only on the wedding originals and on the clean master.
 */

import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNamingModel, renderNamingPage } from "./lib/naming-tool.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reviewDir = join(repoRoot, "metadata", "identity-review");
const htmlFile = join(reviewDir, "name-people.html");
const modelFile = join(reviewDir, "naming-tool-model.json");

async function main() {
  // "../../" walks from metadata/identity-review/ back to the repository root,
  // so the same repo-relative asset paths also resolve over file://.
  const model = await buildNamingModel({ repoRoot, assetBase: "../../", readOnly: true });

  await fs.writeFile(modelFile, JSON.stringify(model, null, 2) + "\n");
  await fs.writeFile(htmlFile, renderNamingPage(model));

  const lines = [
    `Wrote ${relative(repoRoot, htmlFile)}`,
    `Wrote ${relative(repoRoot, modelFile)}`,
    `Faces to name: ${model.counts.items}` +
      ` (${model.counts.missing} untagged photos, ${model.counts.partial} extra faces)`,
    `Look-alike rows: ${model.counts.groups} covering ${model.counts.grouped} faces`,
    `Guest list: ${model.counts.roster} names`,
  ];
  if (model.counts.alreadyDecided) {
    lines.push(`Already answered in an earlier session: ${model.counts.alreadyDecided}`);
  }
  if (model.counts.uncatalogued) {
    lines.push(
      `Skipped ${model.counts.uncatalogued} photos no longer in the catalog` +
        " (Sneak Peek duplicates consolidated into the copies that were kept)",
    );
  }
  if (model.counts.undisplayable) {
    lines.push(`Skipped ${model.counts.undisplayable} rows with no image to show`);
  }
  lines.push("", "To actually name faces, run: npm run tag");
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
});
