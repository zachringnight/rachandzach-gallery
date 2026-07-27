#!/usr/bin/env node
/**
 * Import human decisions from the private recurring-face tagger.
 *
 * Default mode is read-only. `--write` writes validated updates to the tracked
 * face-tag overlay and generated local catalog, replacing each file
 * atomically. It never opens or changes wedding originals and it never writes
 * to Supabase; the existing additive live-sync script remains a separate,
 * explicit step.
 */

import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyCatalogOverlays } from "../lib/catalog-overlays.mjs";

const RECURRING_CONFIRMATION_KIND = "human-recurring-cluster";
const RECURRING_REVIEW_TYPE =
  "Human identity assignment for recurring unnamed face clusters";
const CLUSTER_ID_PATTERN = /^z\d{3}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const HASH_PATTERN = /^[0-9a-f]{32}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");
const reportPath = join(repoRoot, "metadata", "faces", "zero-tag-review.json");
const catalogPath = join(repoRoot, "src", "generated", "gallery-v2.json");
const attendancePath = join(repoRoot, "metadata", "wedding-attendees.json");
const manifestPath = join(
  repoRoot,
  "metadata",
  "reviewed-face-tag-additions.json",
);

function invariant(condition, message) {
  if (!condition) throw new Error(`Recurring face decisions invalid: ${message}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function faceMap(report) {
  return new Map(
    report.photos.flatMap((photo) =>
      photo.faces.map((face) => [
        face.faceKey,
        {
          ...face,
          photoId: photo.photoId,
          path: photo.path,
        },
      ]),
    ),
  );
}

function validateInputs(report, catalog, manifest, decisionFile) {
  invariant(report?.schemaVersion === 1, "review report schemaVersion must be 1");
  invariant(
    FINGERPRINT_PATTERN.test(report.inputsFingerprint),
    "review report fingerprint is invalid",
  );
  invariant(Array.isArray(report.clusters), "review report clusters are missing");
  invariant(Array.isArray(report.photos), "review report photos are missing");
  invariant(Array.isArray(catalog?.photos), "catalog photos are missing");
  invariant(Array.isArray(catalog?.people), "catalog people are missing");
  invariant(manifest?.schemaVersion === 1, "face-tag manifest schemaVersion must be 1");
  invariant(Array.isArray(manifest.additions), "face-tag additions are missing");
  invariant(
    Array.isArray(manifest.source?.reviewWaves),
    "face-tag review waves are missing",
  );
  invariant(
    decisionFile?.schemaVersion === 1,
    "decision file schemaVersion must be 1",
  );
  invariant(
    decisionFile.reportFingerprint === report.inputsFingerprint,
    "decision file was exported from a different review report; rebuild the tagger before importing",
  );
  invariant(
    Array.isArray(decisionFile.decisions),
    "decision file decisions are missing",
  );
}

function normalizeDecisions(decisionFile) {
  const seen = new Set();
  return decisionFile.decisions.map((raw) => {
    invariant(
      raw && typeof raw === "object",
      "every decision must be an object",
    );
    invariant(
      CLUSTER_ID_PATTERN.test(raw.clusterId),
      `invalid cluster id ${String(raw.clusterId)}`,
    );
    invariant(
      !seen.has(raw.clusterId),
      `cluster ${raw.clusterId} appears more than once`,
    );
    seen.add(raw.clusterId);
    invariant(
      raw.action === "tag" || raw.action === "hold",
      `cluster ${raw.clusterId} has invalid action`,
    );
    if (raw.action === "tag") {
      invariant(
        SLUG_PATTERN.test(raw.personSlug),
        `cluster ${raw.clusterId} has invalid person slug`,
      );
    }
    return {
      clusterId: raw.clusterId,
      action: raw.action,
      ...(raw.action === "tag" ? { personSlug: raw.personSlug } : {}),
    };
  });
}

function findOrCreateManualWave(source, fingerprint) {
  const existing = source.reviewWaves.find(
    (wave) =>
      wave.reviewType === RECURRING_REVIEW_TYPE &&
      wave.auditFingerprint === fingerprint,
  );
  if (existing) {
    invariant(
      existing.manualConfirmation === true,
      "existing recurring review wave is not marked as human-confirmed",
    );
    return existing;
  }
  const waveNumber =
    Math.max(0, ...source.reviewWaves.map((wave) => Number(wave.wave) || 0)) + 1;
  const wave = {
    wave: waveNumber,
    auditFingerprint: fingerprint,
    reviewType: RECURRING_REVIEW_TYPE,
    reviewMethod:
      "Zach selected one wedding-roster identity for a privately reviewed same-face cluster. The assignment propagates only to the photographs represented in that cluster and does not depend on a model-similarity threshold.",
    manualConfirmation: true,
    candidatesReviewed: 0,
    candidatesApproved: 0,
    candidatesRejected: 0,
    repeatedClustersIdentified: 0,
  };
  source.reviewWaves.push(wave);
  return wave;
}

function refreshManifestSource(manifest, wave, fingerprint, reviewedAt) {
  const waveAdditions = manifest.additions.filter(
    (addition) =>
      addition.reviewWave === wave.wave &&
      addition.confirmationKind === RECURRING_CONFIRMATION_KIND,
  );
  wave.candidatesReviewed = waveAdditions.length;
  wave.candidatesApproved = waveAdditions.length;
  wave.candidatesRejected = 0;
  wave.repeatedClustersIdentified = new Set(
    waveAdditions.map((addition) => addition.clusterId),
  ).size;

  const fingerprints = new Set(manifest.source.auditFingerprints ?? []);
  fingerprints.add(fingerprint);
  manifest.source.auditFingerprints = [...fingerprints];
  manifest.source.auditFingerprint = fingerprint;
  manifest.source.reviewedAt = reviewedAt;
  if (!String(manifest.source.reviewedBy).includes("Zach")) {
    manifest.source.reviewedBy = `${manifest.source.reviewedBy} + Zach recurring-face identification`;
  }
  const recurringMethod =
    "Recurring unnamed clusters are promoted only when Zach selects an attendee in the private local tagger; those human decisions do not depend on model similarity.";
  if (!String(manifest.source.reviewMethod).includes(recurringMethod)) {
    manifest.source.reviewMethod = `${manifest.source.reviewMethod} ${recurringMethod}`;
  }
  manifest.source.candidatesApproved = manifest.additions.length;
  manifest.source.candidatesReviewed =
    manifest.additions.length + Number(manifest.source.candidatesRejected ?? 0);
}

export function buildRecurringFaceTagUpdate({
  report,
  catalog,
  manifest,
  decisionFile,
  reviewedAt,
}) {
  validateInputs(report, catalog, manifest, decisionFile);
  invariant(
    /^\d{4}-\d{2}-\d{2}$/.test(reviewedAt),
    "reviewedAt must be YYYY-MM-DD",
  );

  const next = clone(manifest);
  const decisions = normalizeDecisions(decisionFile);
  const clusterById = new Map(
    report.clusters.map((cluster) => [cluster.clusterId, cluster]),
  );
  const facesByKey = faceMap(report);
  const photosById = new Map(
    catalog.photos.flatMap((photo) => [
      [photo.id, photo],
      [photo.imageDataHash, photo],
    ]),
  );
  const peopleBySlug = new Map(
    catalog.people.map((person) => [person.slug, person]),
  );
  const existingPairs = new Map(
    next.additions.map((addition) => [
      `${addition.photoId}:${addition.personSlug}`,
      addition,
    ]),
  );
  const pendingPairClusters = new Map();
  let wave = null;

  let taggedClusters = 0;
  let heldClusters = 0;
  let additionsCreated = 0;
  let additionsAlreadyTracked = 0;

  for (const decision of decisions) {
    const cluster = clusterById.get(decision.clusterId);
    invariant(cluster, `unknown cluster ${decision.clusterId}`);
    invariant(
      cluster.repeated === true && cluster.photoCount >= 2,
      `cluster ${decision.clusterId} is not a recurring cluster`,
    );
    invariant(
      cluster.samePhotoConflictCount === 0,
      `cluster ${decision.clusterId} contains conflicting faces in one photo`,
    );
    if (decision.action === "hold") {
      heldClusters += 1;
      continue;
    }

    const person = peopleBySlug.get(decision.personSlug);
    invariant(
      person,
      `cluster ${decision.clusterId} references unknown person ${decision.personSlug}`,
    );
    wave ??= findOrCreateManualWave(
      next.source,
      report.inputsFingerprint,
    );
    taggedClusters += 1;

    for (const member of cluster.members) {
      const face = facesByKey.get(member);
      invariant(face, `cluster ${decision.clusterId} references missing face ${member}`);
      invariant(
        HASH_PATTERN.test(face.photoId),
        `cluster ${decision.clusterId} has invalid photo hash`,
      );
      const photo = photosById.get(face.photoId);
      invariant(
        photo,
        `cluster ${decision.clusterId} references missing photo ${face.photoId}`,
      );
      invariant(
        photo.originalRelativePath === face.path,
        `cluster ${decision.clusterId} photo path drifted for ${face.photoId}`,
      );

      const pair = `${face.photoId}:${person.slug}`;
      const owner = pendingPairClusters.get(pair);
      invariant(
        !owner || owner === decision.clusterId,
        `clusters ${owner} and ${decision.clusterId} both assign ${person.name} to the same photo`,
      );
      pendingPairClusters.set(pair, decision.clusterId);

      const existing = existingPairs.get(pair);
      if (existing) {
        invariant(
          existing.confirmationKind !== RECURRING_CONFIRMATION_KIND ||
            existing.clusterId === decision.clusterId,
          `clusters ${existing.clusterId} and ${decision.clusterId} both assign ${person.name} to the same photo`,
        );
        additionsAlreadyTracked += 1;
        continue;
      }

      const addition = {
        photoId: face.photoId,
        path: face.path,
        personSlug: person.slug,
        displayName: person.name,
        faceIndex: face.faceIndex,
        confirmationKind: RECURRING_CONFIRMATION_KIND,
        reviewWave: wave.wave,
        clusterId: decision.clusterId,
        clusterFingerprint: report.inputsFingerprint,
        contextEvidence:
          `Zach identified private recurring face cluster ${decision.clusterId} as ${person.name} across ${cluster.photoCount} photographs.`,
      };
      next.additions.push(addition);
      existingPairs.set(pair, addition);
      additionsCreated += 1;
    }
  }

  if (wave) {
    refreshManifestSource(
      next,
      wave,
      report.inputsFingerprint,
      reviewedAt,
    );
  }

  return {
    manifest: next,
    summary: {
      decisionClusters: decisions.length,
      taggedClusters,
      heldClusters,
      additionsCreated,
      additionsAlreadyTracked,
      totalTrackedAdditions: next.additions.length,
      reviewWave: wave?.wave ?? null,
      reportFingerprint: report.inputsFingerprint,
    },
  };
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function atomicWriteJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, path);
}

function parseArguments(argv) {
  const write = argv.includes("--write");
  const positional = argv.filter((argument) => argument !== "--write");
  invariant(
    positional.length === 1,
    "usage: import-recurring-face-decisions.mjs <decisions.json> [--write]",
  );
  return { decisionPath: resolve(positional[0]), write };
}

async function main() {
  const { decisionPath, write } = parseArguments(process.argv.slice(2));
  const [report, catalog, attendance, manifest, decisionFile] =
    await Promise.all([
      readJson(reportPath),
      readJson(catalogPath),
      readJson(attendancePath),
      readJson(manifestPath),
      readJson(decisionPath),
    ]);
  const { manifest: updatedManifest, summary } =
    buildRecurringFaceTagUpdate({
      report,
      catalog,
      manifest,
      decisionFile,
      reviewedAt: new Date().toISOString().slice(0, 10),
    });

  let overlay = null;
  if (write) {
    const updatedCatalog = clone(catalog);
    overlay = applyCatalogOverlays(
      updatedCatalog,
      attendance,
      updatedManifest,
    );
    await atomicWriteJson(manifestPath, updatedManifest);
    await atomicWriteJson(catalogPath, updatedCatalog);
  }

  console.log(
    JSON.stringify(
      {
        mode: write ? "written-local-only" : "dry-run",
        decisionFile: decisionPath,
        ...summary,
        ...(overlay ? { catalogOverlay: overlay } : {}),
        liveSyncPerformed: false,
      },
      null,
      2,
    ),
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
