#!/usr/bin/env node
/**
 * The face-naming session.
 *
 *   npm run tag
 *
 * Builds the queue, starts a server on 127.0.0.1 that nothing outside this Mac
 * can reach, and opens it in the browser. Each answer is written straight to
 * the tracked decision records, atomically, and undo reverts the written
 * record rather than just the screen.
 *
 * Read-only on every photograph: the page is served preview derivatives from
 * `metadata/import/`, and the wedding originals are served byte-for-byte and
 * never written.
 */

import { spawn } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildNamingModel, renderNamingPage, SOURCE_DIR_NAME } from "./lib/naming-tool.mjs";
import { backupDecisionFiles, DecisionError, NamingSession } from "./lib/naming-decisions.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repoRoot, "..", SOURCE_DIR_NAME);

// Only these trees are readable over the loopback server, and only for GET.
const ASSET_ROOTS = [
  join(repoRoot, "metadata", "import", "derivatives"),
  join(repoRoot, "metadata", "identity-review"),
  join(repoRoot, "public", "faces"),
];

const MIME = {
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
};

function withinAny(path, roots) {
  return roots.some((root) => path === root || path.startsWith(root + sep));
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

async function readBody(request, limit = 256 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > limit) throw new DecisionError("request too large");
    chunks.push(chunk);
  }
  if (!total) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveFile(response, absolutePath, contentType) {
  const stats = await fs.stat(absolutePath).catch(() => null);
  if (!stats || !stats.isFile()) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": contentType || MIME[extname(absolutePath).toLowerCase()] || "application/octet-stream",
    "content-length": String(stats.size),
    // Derivatives never change during a session, so let the browser keep them.
    "cache-control": "private, max-age=86400",
  });
  createReadStream(absolutePath).pipe(response);
}

async function main() {
  const port = Number(process.env.TAG_PORT || 4310);
  const noOpen = process.argv.includes("--no-open");

  process.stdout.write("Building the naming queue...\n");
  const model = await buildNamingModel({ repoRoot, assetBase: "/" });
  const backups = await backupDecisionFiles(repoRoot);
  const session = await NamingSession.open({ repoRoot, model });
  model.decided = session.decidedSnapshot();
  const page = renderNamingPage(model);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const route = decodeURIComponent(url.pathname);

    try {
      if (request.method === "POST") {
        const body = await readBody(request);
        if (body.buildFingerprint && body.buildFingerprint !== model.buildFingerprint) {
          throw new DecisionError("This page is out of date. Reload it and try again.");
        }
        if (route === "/api/decide") {
          const result = await session.apply(body);
          return sendJson(response, 200, { ok: true, ...result });
        }
        if (route === "/api/undo") {
          const result = await session.undo();
          return sendJson(response, 200, { ok: true, ...result });
        }
        if (route === "/api/note") {
          const result = await session.setNote(body);
          return sendJson(response, 200, { ok: true, ...result });
        }
        return sendJson(response, 404, { ok: false, error: "unknown endpoint" });
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return sendJson(response, 405, { ok: false, error: "method not allowed" });
      }

      if (route === "/" || route === "/index.html") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        return response.end(page);
      }
      if (route === "/api/state") {
        return sendJson(response, 200, {
          ok: true,
          decided: session.decidedSnapshot(),
          summary: session.summary(),
        });
      }
      if (route.startsWith("/original/")) {
        // Read-only view of the untouched source JPEG.
        const target = normalize(join(sourceRoot, route.slice("/original/".length)));
        if (!withinAny(target, [sourceRoot])) {
          response.writeHead(403);
          return response.end("Forbidden");
        }
        return serveFile(response, target);
      }

      const target = normalize(join(repoRoot, route));
      if (!withinAny(target, ASSET_ROOTS)) {
        response.writeHead(403);
        return response.end("Forbidden");
      }
      return serveFile(response, target);
    } catch (error) {
      const known = error instanceof DecisionError;
      if (!known) process.stderr.write(String(error?.stack || error) + "\n");
      return sendJson(response, known ? 400 : 500, {
        ok: false,
        error: known ? error.message : "Something went wrong saving that. Nothing was changed.",
      });
    }
  });

  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });

  const address = `http://127.0.0.1:${port}/`;
  const alreadyDone = Object.keys(model.decided).length;
  process.stdout.write(
    [
      "",
      `Faces to name: ${model.counts.items}` +
        (alreadyDone ? `  (${alreadyDone} already answered)` : ""),
      `Look-alike rows: ${model.counts.groups} covering ${model.counts.grouped} faces, biggest first`,
      model.counts.droppedUnrecognizable
        ? `Left out: ${model.counts.droppedUnrecognizable} faces too small or blurred to recognize`
        : null,
      `Guest list: ${model.counts.roster} names`,
      model.counts.uncatalogued
        ? `Skipped ${model.counts.uncatalogued} Sneak Peek duplicates that are no longer in the catalog`
        : null,
      `Backed up: ${backups.length} decision files under metadata/identity-review/backups/`,
      "",
      `Open: ${address}`,
      "Answers are written to metadata/reviewed-face-tag-additions.json as you go.",
      "Press Ctrl+C when you are finished.",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n"),
  );

  if (!noOpen) spawn("open", [address], { stdio: "ignore", detached: true }).unref();

  let closing = false;
  const finish = () => {
    if (closing) return;
    closing = true;
    const summary = session.summary();
    process.stdout.write(
      [
        "",
        "Session finished.",
        `  faces named:     ${summary.facesNamed}`,
        `  names added:     ${summary.namesAdded}`,
        `  not a guest:     ${summary.notAGuest}`,
        `  not sure:        ${summary.notSure}`,
        `  too blurry:      ${summary.tooBlurry}`,
        `  names removed:   ${summary.namesRemoved}`,
        "",
        "Fold them into the local catalog with:",
        "  node scripts/apply-catalog-overlays.mjs --write",
        "",
      ].join("\n"),
    );
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", finish);
  process.on("SIGTERM", finish);
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
});
