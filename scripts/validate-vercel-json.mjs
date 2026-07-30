#!/usr/bin/env node
/**
 * Guards vercel.json against the failure that cost four deployments.
 *
 * Vercel validates vercel.json against https://openapi.vercel.sh/vercel.json,
 * which sets "additionalProperties": false at the top level. A key the schema
 * does not define is a hard deployment failure -- including the "//comment"
 * convention, which is exactly what happened: a "//regions" key added in
 * f5731e9 broke every deployment from that commit onward, three of them
 * production, and nobody noticed because a failed deploy leaves the previous
 * build serving.
 *
 * Scope is deliberately narrow: this checks the shape of the top-level object,
 * not the whole schema. That is the class of mistake a human editing this file
 * by hand actually makes, and a narrow check that always runs beats a complete
 * one that needs a draft-04 validator this project does not depend on.
 *
 * Prefers the live published schema so it cannot go stale; falls back to a
 * pinned key list offline, and says which one it used.
 *
 * See docs/VERCEL_CONFIG.md. Run: node scripts/validate-vercel-json.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCHEMA_URL = "https://openapi.vercel.sh/vercel.json";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Snapshot of the schema's top-level properties, taken 2026-07-30. Only used
 * when the live schema is unreachable. Being out of date here can produce a
 * false positive on a genuinely new Vercel setting, never a false negative on
 * a "//comment" key, which is the thing this script exists to catch.
 */
const PINNED_TOP_LEVEL_KEYS = [
  "$schema", "alias", "buildCommand", "build", "cleanUrls", "crons",
  "devCommand", "framework", "functions", "functionFailoverRegions",
  "git", "github", "headers", "ignoreCommand", "images", "installCommand",
  "name", "outputDirectory", "public", "redirects", "regions", "rewrites",
  "routes", "trailingSlash", "version",
];

async function loadSchemaKeys() {
  try {
    const response = await fetch(SCHEMA_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const schema = await response.json();
    const keys = Object.keys(schema?.properties ?? {});
    if (keys.length === 0) throw new Error("schema had no properties");
    return { keys, source: "live schema", sealed: schema.additionalProperties === false };
  } catch (error) {
    console.warn(
      `! Could not read ${SCHEMA_URL} (${error.message}); falling back to the ` +
        "pinned key list. A failure below is still real; a pass is slightly weaker.",
    );
    return { keys: PINNED_TOP_LEVEL_KEYS, source: "pinned list", sealed: true };
  }
}

const configPath = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "vercel.json",
);

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  console.error(`FAIL  vercel.json is not parseable JSON: ${error.message}`);
  process.exit(1);
}

const { keys: allowed, source, sealed } = await loadSchemaKeys();
const unknown = Object.keys(config).filter((key) => !allowed.includes(key));

if (unknown.length > 0 && sealed) {
  console.error(
    `FAIL  vercel.json has ${unknown.length} top-level key(s) the schema does ` +
      `not define (checked against the ${source}):\n` +
      unknown.map((key) => `        ${JSON.stringify(key)}`).join("\n") +
      "\n\n      Vercel rejects the whole deployment for these, before the " +
      "build starts.\n      If one is a comment, move the prose to " +
      "docs/VERCEL_CONFIG.md instead.",
  );
  process.exit(1);
}

console.log(`OK    vercel.json top-level keys valid (checked against the ${source}).`);
