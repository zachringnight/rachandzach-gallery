#!/usr/bin/env node
/**
 * Build the private, local recurring-face tagger.
 *
 * The generated HTML and every image it references stay under gitignored
 * metadata paths on this Mac. The page contains no embeddings or saved-profile
 * similarity suggestions. It records Zach's decisions in browser localStorage
 * and exports a small JSON file for the additive importer.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "../..");
const reportPath = join(repoRoot, "metadata", "faces", "zero-tag-review.json");
const catalogPath = join(repoRoot, "src", "generated", "gallery-v2.json");
const derivativesRoot = join(
  repoRoot,
  "metadata",
  "import",
  "derivatives",
  "previews",
);
const committedFacesRoot = join(repoRoot, "public", "faces");
const outputPath = join(
  repoRoot,
  "metadata",
  "faces",
  "recurring-face-tagger",
  "index.html",
);

function invariant(condition, message) {
  if (!condition) throw new Error(`Recurring face tagger invalid: ${message}`);
}

function round(value) {
  return Number(value.toFixed(6));
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function privateFileUrl(path) {
  return relative(dirname(outputPath), path)
    .split(sep)
    .map((part) => (part === ".." ? part : encodeURIComponent(part)))
    .join("/");
}

function normalizedFaceCrop(face, photo) {
  const [x1, y1, x2, y2] = face.bbox.map(Number);
  const width = Number(photo.dw);
  const height = Number(photo.dh);
  invariant(
    [x1, y1, x2, y2, width, height].every(Number.isFinite),
    `face ${face.faceKey} has invalid geometry`,
  );
  invariant(
    x2 > x1 && y2 > y1 && width > 0 && height > 0,
    `face ${face.faceKey} has empty geometry`,
  );
  const minimumSide = Math.min(width, height);
  const side = Math.min(Math.max(x2 - x1, y2 - y1) * 2.15, minimumSide);
  const left = clamp((x1 + x2) / 2 - side / 2, 0, width - side);
  const top = clamp((y1 + y2) / 2 - side / 2, 0, height - side);
  return {
    x: round(left / width),
    y: round(top / height),
    size: round(side / minimumSide),
  };
}

function normalizedFaceBox(face, photo) {
  const [x1, y1, x2, y2] = face.bbox.map(Number);
  return {
    x: round(x1 / photo.dw),
    y: round(y1 / photo.dh),
    width: round((x2 - x1) / photo.dw),
    height: round((y2 - y1) / photo.dh),
  };
}

export function buildRecurringFaceTaggerModel({
  report,
  catalog,
  derivativeUrls,
  committedFaceUrls,
}) {
  invariant(report?.schemaVersion === 1, "report schemaVersion must be 1");
  invariant(
    /^[0-9a-f]{64}$/.test(report.inputsFingerprint),
    "report fingerprint is invalid",
  );
  invariant(Array.isArray(report.clusters), "report clusters are missing");
  invariant(Array.isArray(report.photos), "report photos are missing");
  invariant(Array.isArray(catalog?.people), "catalog people are missing");

  const faceByKey = new Map(
    report.photos.flatMap((photo) =>
      photo.faces.map((face) => [face.faceKey, { face, photo }]),
    ),
  );
  const clusters = report.clusters
    .filter((cluster) => cluster.repeated)
    .map((cluster) => {
      invariant(
        /^z\d{3}$/.test(cluster.clusterId),
        `invalid cluster ${String(cluster.clusterId)}`,
      );
      invariant(
        cluster.samePhotoConflictCount === 0,
        `cluster ${cluster.clusterId} contains conflicting faces in one photo`,
      );
      const members = cluster.members.map((faceKey, index) => {
        const record = faceByKey.get(faceKey);
        invariant(
          record,
          `cluster ${cluster.clusterId} references unknown face ${faceKey}`,
        );
        const { face, photo } = record;
        const photoUrl = derivativeUrls[photo.photoId];
        invariant(
          typeof photoUrl === "string" && photoUrl.length > 0,
          `photo ${photo.photoId} has no private preview derivative`,
        );
        return {
          id: `${cluster.clusterId}-${index + 1}`,
          faceIndex: face.faceIndex,
          filename: basename(photo.path),
          path: photo.path,
          event: photo.event,
          photoUrl,
          aspectRatio: round(photo.dw / photo.dh),
          crop: normalizedFaceCrop(face, photo),
          box: normalizedFaceBox(face, photo),
        };
      });
      invariant(
        new Set(members.map((member) => member.path)).size ===
          cluster.photoCount,
        `cluster ${cluster.clusterId} photo count drifted`,
      );
      return {
        id: cluster.clusterId,
        faceCount: cluster.faceCount,
        photoCount: cluster.photoCount,
        members,
      };
    });

  const people = [...catalog.people]
    .map((person) => ({
      slug: person.slug,
      name: person.name,
      photoCount: person.photoCount,
      faceUrl: committedFaceUrls[person.slug] ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));

  return {
    schemaVersion: 1,
    reportFingerprint: report.inputsFingerprint,
    clusters,
    people,
    counts: {
      clusters: clusters.length,
      faces: clusters.reduce((total, cluster) => total + cluster.faceCount, 0),
      photos: new Set(
        clusters.flatMap((cluster) =>
          cluster.members.map((member) => member.path),
        ),
      ).size,
      people: people.length,
    },
  };
}

function jsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const css = String.raw`
  :root {
    color-scheme: light;
    --cream: #f4efe5;
    --paper: #fffdf8;
    --paper-soft: #faf6ee;
    --ink: #2b241d;
    --muted: #74695d;
    --sand: #d9cdbd;
    --wheat: #eadfcf;
    --olive: #56624e;
    --olive-soft: #e7ece3;
    --terracotta: #a76048;
    --terracotta-soft: #f6e9e2;
    --shadow: 0 18px 46px rgba(53, 43, 34, 0.10);
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  html {
    min-height: 100%;
    background: var(--cream);
    color: var(--ink);
    font-family: "Avenir Next", Avenir, Inter, ui-sans-serif, system-ui, sans-serif;
  }
  body { margin: 0; min-height: 100vh; }
  button, input { font: inherit; }
  button { cursor: pointer; }
  button:focus-visible, input:focus-visible {
    outline: 3px solid rgba(167, 96, 72, 0.28);
    outline-offset: 2px;
  }
  [hidden] { display: none !important; }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    border-bottom: 1px solid rgba(120, 102, 84, 0.22);
    background: rgba(244, 239, 229, 0.96);
    backdrop-filter: blur(14px);
  }
  .topbar-inner {
    width: min(1240px, calc(100% - 40px));
    margin: 0 auto;
    padding: 18px 0 15px;
  }
  .heading-row {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
  }
  .kicker {
    margin: 0 0 3px;
    color: var(--terracotta);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  h1, h2 {
    margin: 0;
    font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    font-weight: 500;
    letter-spacing: -0.02em;
  }
  h1 { font-size: clamp(30px, 4vw, 46px); line-height: 1; }
  .safety {
    max-width: 520px;
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.45;
    text-align: right;
  }
  .progress-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 14px;
    margin-top: 14px;
  }
  .progress-track {
    height: 6px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--wheat);
  }
  .progress-fill {
    width: 0;
    height: 100%;
    border-radius: inherit;
    background: var(--olive);
    transition: width 180ms ease;
  }
  .progress-label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
    white-space: nowrap;
  }
  .toolbar {
    width: min(1240px, calc(100% - 40px));
    margin: 18px auto 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .mode-group, .toolbar-actions, .nav-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  .button {
    min-height: 39px;
    border: 1px solid var(--sand);
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink);
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 760;
    transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
  }
  .button:hover:not(:disabled) {
    border-color: var(--olive);
    transform: translateY(-1px);
  }
  .button[aria-pressed="true"] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--paper);
  }
  .button.primary {
    border-color: var(--olive);
    background: var(--olive);
    color: var(--paper);
  }
  .button.warm {
    border-color: var(--terracotta);
    background: var(--terracotta);
    color: var(--paper);
  }
  .button.quiet { background: transparent; }
  .button:disabled { cursor: default; opacity: 0.42; }
  main {
    width: min(1240px, calc(100% - 40px));
    margin: 18px auto 60px;
  }
  .review-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(310px, 380px);
    gap: 18px;
    align-items: start;
  }
  .panel {
    border: 1px solid rgba(120, 102, 84, 0.22);
    border-radius: var(--radius);
    background: var(--paper);
    box-shadow: var(--shadow);
  }
  .cluster-panel { padding: 22px; }
  .cluster-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
  }
  .cluster-heading h2 { font-size: clamp(26px, 3vw, 36px); }
  .cluster-copy {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.5;
  }
  .cluster-number {
    min-width: 72px;
    border: 1px solid var(--sand);
    border-radius: 999px;
    padding: 6px 10px;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    text-align: center;
  }
  .face-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .face-card {
    overflow: hidden;
    border: 1px solid var(--sand);
    border-radius: 8px;
    background: var(--paper-soft);
    padding: 0;
    text-align: left;
    transition: border-color 140ms ease, transform 140ms ease;
  }
  .face-card:hover {
    border-color: var(--terracotta);
    transform: translateY(-2px);
  }
  .face-crop {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: #ded4c5;
  }
  .face-crop img {
    position: absolute;
    display: block;
    max-width: none;
  }
  .face-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 10px 10px;
    color: var(--muted);
    font-size: 11px;
  }
  .face-meta strong {
    overflow: hidden;
    color: var(--ink);
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .identity-panel {
    position: sticky;
    top: 142px;
    display: grid;
    gap: 16px;
    padding: 20px;
  }
  .decision-state {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border-bottom: 1px solid var(--wheat);
    padding-bottom: 13px;
  }
  .decision-state span:first-child {
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .state-pill {
    border-radius: 999px;
    background: var(--terracotta-soft);
    color: var(--terracotta);
    padding: 5px 9px;
    font-size: 11px;
    font-weight: 800;
  }
  .state-pill.tagged { background: var(--olive-soft); color: var(--olive); }
  .reference {
    display: grid;
    grid-template-columns: 82px 1fr;
    align-items: center;
    gap: 13px;
  }
  .reference-face {
    position: relative;
    display: grid;
    width: 82px;
    aspect-ratio: 1;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--sand);
    border-radius: 50%;
    background: var(--wheat);
    color: var(--muted);
    font-family: "Iowan Old Style", Georgia, serif;
    font-size: 24px;
  }
  .reference-face img { width: 100%; height: 100%; object-fit: cover; }
  .reference-copy strong { display: block; font-size: 15px; }
  .reference-copy p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .person-field { display: grid; gap: 7px; }
  .person-field label {
    color: var(--muted);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .person-field input {
    width: 100%;
    min-height: 46px;
    border: 1px solid var(--sand);
    border-radius: 7px;
    background: #fff;
    color: var(--ink);
    padding: 10px 12px;
  }
  .validation {
    min-height: 18px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .validation.valid { color: var(--olive); font-weight: 720; }
  .validation.invalid { color: var(--terracotta); }
  .decision-actions { display: grid; gap: 8px; }
  .decision-actions .button { width: 100%; border-radius: 7px; }
  .nav-actions .button { flex: 1; border-radius: 7px; }
  .empty {
    border: 1px solid var(--sand);
    border-radius: var(--radius);
    background: var(--paper);
    padding: 50px 24px;
    color: var(--muted);
    text-align: center;
  }
  .empty h2 { margin-bottom: 8px; color: var(--ink); font-size: 30px; }
  .after-review {
    margin-top: 18px;
    border: 1px solid var(--sand);
    border-radius: var(--radius);
    background: rgba(255, 253, 248, 0.72);
    padding: 14px 16px;
  }
  .after-review summary {
    cursor: pointer;
    color: var(--ink);
    font-size: 13px;
    font-weight: 760;
  }
  .after-review p {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.55;
  }
  .after-review code {
    display: block;
    overflow-x: auto;
    margin-top: 9px;
    border-radius: 6px;
    background: var(--ink);
    color: var(--paper);
    padding: 10px 12px;
    font-size: 11px;
    white-space: nowrap;
  }
  dialog {
    width: min(980px, calc(100vw - 30px));
    max-width: none;
    border: 0;
    border-radius: 10px;
    background: var(--paper);
    box-shadow: 0 30px 90px rgba(32, 25, 19, 0.32);
    padding: 14px;
  }
  dialog::backdrop { background: rgba(32, 25, 19, 0.76); }
  .context-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }
  .context-head strong { font-size: 13px; }
  .context-photo {
    position: relative;
    margin: 0 auto;
    overflow: hidden;
    background: #211d18;
  }
  .context-photo img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .context-box {
    position: absolute;
    border: 3px solid #f0cf76;
    border-radius: 4px;
    box-shadow: 0 0 0 9999px rgba(24, 20, 16, 0.24);
    pointer-events: none;
  }
  .toast {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 40;
    transform: translateY(12px);
    opacity: 0;
    border: 1px solid var(--sand);
    border-radius: 999px;
    background: var(--paper);
    box-shadow: var(--shadow);
    padding: 10px 14px;
    color: var(--olive);
    font-size: 12px;
    font-weight: 780;
    transition: opacity 150ms ease, transform 150ms ease;
    pointer-events: none;
  }
  .toast.visible { transform: translateY(0); opacity: 1; }
  @media (max-width: 840px) {
    .topbar-inner, .toolbar, main { width: min(100% - 24px, 720px); }
    .heading-row { align-items: start; flex-direction: column; gap: 8px; }
    .safety { max-width: none; text-align: left; }
    .toolbar { align-items: stretch; flex-direction: column; }
    .mode-group, .toolbar-actions { display: grid; grid-template-columns: repeat(2, 1fr); }
    .review-layout { grid-template-columns: 1fr; }
    .identity-panel { position: static; }
  }
  @media (max-width: 500px) {
    .topbar-inner { padding-top: 13px; }
    h1 { font-size: 31px; }
    .safety { font-size: 12px; }
    .progress-row { grid-template-columns: 1fr; gap: 7px; }
    .progress-label { white-space: normal; }
    .cluster-panel { padding: 14px; }
    .cluster-heading { align-items: start; flex-direction: column-reverse; }
    .face-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
    .face-meta { align-items: start; flex-direction: column; }
    .identity-panel { padding: 16px; }
    .toolbar-actions .button:last-child { grid-column: 1 / -1; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

const clientJs = String.raw`
(() => {
  const data = JSON.parse(document.getElementById("tagger-data").textContent);
  const storageKey = "rzRecurringFaceTags:" + data.reportFingerprint;
  let state = new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(saved)) state = new Map(saved);
  } catch {
    state = new Map();
  }
  let mode = "open";
  let currentClusterId = data.clusters[0] ? data.clusters[0].id : "";
  let currentIndex = 0;
  let toastTimer = null;

  const els = {
    progressFill: document.getElementById("progress-fill"),
    progressLabel: document.getElementById("progress-label"),
    modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
    review: document.getElementById("review-layout"),
    empty: document.getElementById("empty"),
    emptyTitle: document.getElementById("empty-title"),
    emptyCopy: document.getElementById("empty-copy"),
    clusterTitle: document.getElementById("cluster-title"),
    clusterCopy: document.getElementById("cluster-copy"),
    clusterNumber: document.getElementById("cluster-number"),
    faceGrid: document.getElementById("face-grid"),
    statePill: document.getElementById("state-pill"),
    personInput: document.getElementById("person-input"),
    referenceFace: document.getElementById("reference-face"),
    referenceName: document.getElementById("reference-name"),
    referenceCopy: document.getElementById("reference-copy"),
    validation: document.getElementById("validation"),
    confirm: document.getElementById("confirm-name"),
    hold: document.getElementById("hold-cluster"),
    clear: document.getElementById("clear-decision"),
    previous: document.getElementById("previous-cluster"),
    next: document.getElementById("next-cluster"),
    download: document.getElementById("download-decisions"),
    importButton: document.getElementById("import-decisions"),
    importInput: document.getElementById("import-input"),
    contextDialog: document.getElementById("context-dialog"),
    contextTitle: document.getElementById("context-title"),
    contextPhoto: document.getElementById("context-photo"),
    contextImage: document.getElementById("context-image"),
    contextBox: document.getElementById("context-box"),
    closeContext: document.getElementById("close-context"),
    toast: document.getElementById("toast")
  };

  const peopleBySlug = new Map(data.people.map((person) => [person.slug, person]));
  const peopleByName = new Map(
    data.people.map((person) => [person.name.trim().toLowerCase(), person])
  );

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify([...state.entries()]));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 1300);
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function exactPerson(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return null;
    return peopleByName.get(normalized) ||
      data.people.find((person) => person.slug.toLowerCase() === normalized) ||
      null;
  }

  function isResolved(cluster) {
    return state.has(cluster.id);
  }

  function visibleClusters() {
    return data.clusters.filter((cluster) => {
      const decision = state.get(cluster.id);
      if (mode === "open") return !decision;
      if (mode === "tagged") return decision && decision.action === "tag";
      if (mode === "held") return decision && decision.action === "hold";
      return true;
    });
  }

  function currentCluster() {
    const list = visibleClusters();
    if (!list.length) return null;
    const selected = list.find((cluster) => cluster.id === currentClusterId);
    if (selected) {
      currentIndex = list.indexOf(selected);
      return selected;
    }
    currentIndex = Math.min(currentIndex, list.length - 1);
    currentClusterId = list[currentIndex].id;
    return list[currentIndex];
  }

  function faceCropStyle(crop, aspectRatio) {
    const a = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
    const size = Math.min(Math.max(crop.size, 0.0001), 1);
    const width = a >= 1 ? a : 1;
    const height = a >= 1 ? 1 : 1 / a;
    const scale = 1 / size;
    return {
      width: (width * scale * 100) + "%",
      height: (height * scale * 100) + "%",
      left: (-crop.x * width * scale * 100) + "%",
      top: (-crop.y * height * scale * 100) + "%"
    };
  }

  function renderReference(person) {
    els.referenceFace.innerHTML = "";
    if (person && person.faceUrl) {
      const image = document.createElement("img");
      image.src = person.faceUrl;
      image.alt = "";
      image.decoding = "async";
      els.referenceFace.append(image);
    } else {
      els.referenceFace.textContent = person ? initials(person.name) : "?";
    }
    els.referenceName.textContent = person ? person.name : "No person selected";
    els.referenceCopy.textContent = person
      ? person.faceUrl
        ? "Saved face available for a side-by-side identity check."
        : "This attendee has no saved face yet; use the repeated photos and your own recognition."
      : "Choose any attendee from the complete wedding roster.";
  }

  function updatePersonControls() {
    const person = exactPerson(els.personInput.value);
    renderReference(person);
    els.confirm.disabled = !person;
    if (!els.personInput.value.trim()) {
      els.validation.textContent = "Type a name and choose the exact roster entry.";
      els.validation.className = "validation";
    } else if (!person) {
      els.validation.textContent = "Choose an exact name from the wedding roster.";
      els.validation.className = "validation invalid";
    } else {
      els.validation.textContent =
        person.photoCount + (person.photoCount === 1 ? " existing tagged photo" : " existing tagged photos");
      els.validation.className = "validation valid";
    }
    const cluster = currentCluster();
    els.confirm.textContent = cluster && person
      ? "Confirm " + cluster.photoCount + " " +
        (cluster.photoCount === 1 ? "tag" : "tags") + " as " + person.name
      : "Confirm name for this cluster";
  }

  function openContext(member) {
    els.contextTitle.textContent =
      member.filename + " · face " + (Number(member.faceIndex) + 1);
    els.contextImage.src = member.photoUrl;
    els.contextImage.alt = "Full photograph with the recurring face marked";
    els.contextPhoto.style.aspectRatio = String(member.aspectRatio);
    const width = Math.min(
      window.innerWidth * 0.88,
      window.innerHeight * 0.72 * member.aspectRatio
    );
    els.contextPhoto.style.width = Math.max(220, width) + "px";
    els.contextBox.style.left = (member.box.x * 100) + "%";
    els.contextBox.style.top = (member.box.y * 100) + "%";
    els.contextBox.style.width = (member.box.width * 100) + "%";
    els.contextBox.style.height = (member.box.height * 100) + "%";
    els.contextDialog.showModal();
  }

  function renderFaces(cluster) {
    els.faceGrid.innerHTML = "";
    cluster.members.forEach((member, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "face-card";
      button.setAttribute(
        "aria-label",
        "Open full photo for recurring face " + (index + 1)
      );
      const crop = document.createElement("span");
      crop.className = "face-crop";
      const image = document.createElement("img");
      image.src = member.photoUrl;
      image.alt = "";
      image.loading = index < 4 ? "eager" : "lazy";
      image.decoding = "async";
      Object.assign(image.style, faceCropStyle(member.crop, member.aspectRatio));
      crop.append(image);
      const meta = document.createElement("span");
      meta.className = "face-meta";
      const filename = document.createElement("strong");
      filename.textContent = member.filename;
      const event = document.createElement("span");
      event.textContent = member.event.replace(/-/g, " ");
      meta.append(filename, event);
      button.append(crop, meta);
      button.addEventListener("click", () => openContext(member));
      els.faceGrid.append(button);
    });
  }

  function updateProgress() {
    const tagged = data.clusters.filter(
      (cluster) => state.get(cluster.id)?.action === "tag"
    ).length;
    const held = data.clusters.filter(
      (cluster) => state.get(cluster.id)?.action === "hold"
    ).length;
    const resolved = tagged + held;
    els.progressFill.style.width =
      (data.clusters.length ? resolved / data.clusters.length * 100 : 0) + "%";
    els.progressLabel.textContent =
      tagged + " tagged · " + held + " held · " +
      (data.clusters.length - resolved) + " open";
    els.download.textContent =
      "Download " + resolved + " " + (resolved === 1 ? "decision" : "decisions");
    els.download.disabled = resolved === 0;
  }

  function render() {
    for (const button of els.modeButtons) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.mode === mode ? "true" : "false"
      );
    }
    const cluster = currentCluster();
    const list = visibleClusters();
    updateProgress();
    if (!cluster) {
      els.review.hidden = true;
      els.empty.hidden = false;
      els.emptyTitle.textContent =
        mode === "open" ? "Every cluster has a decision" : "Nothing here yet";
      els.emptyCopy.textContent =
        mode === "open"
          ? "Download the decisions when you are ready to import the confirmed tags."
          : "Switch views to continue reviewing recurring faces.";
      return;
    }

    els.review.hidden = false;
    els.empty.hidden = true;
    els.clusterTitle.textContent =
      "Same face in " + cluster.photoCount + " photographs";
    els.clusterCopy.textContent =
      "Compare every crop. Tap a crop for the full photograph before assigning one name to the whole group.";
    els.clusterNumber.textContent =
      cluster.id + " · " + (currentIndex + 1) + "/" + list.length;
    renderFaces(cluster);

    const decision = state.get(cluster.id);
    if (decision?.action === "tag") {
      const person = peopleBySlug.get(decision.personSlug);
      els.personInput.value = person ? person.name : "";
      els.statePill.textContent = "Tagged";
      els.statePill.className = "state-pill tagged";
    } else if (decision?.action === "hold") {
      els.personInput.value = "";
      els.statePill.textContent = "Held";
      els.statePill.className = "state-pill";
    } else {
      els.personInput.value = "";
      els.statePill.textContent = "Open";
      els.statePill.className = "state-pill";
    }
    els.clear.hidden = !decision;
    els.previous.disabled = list.length < 2;
    els.next.disabled = list.length < 2;
    updatePersonControls();
  }

  function go(delta) {
    const list = visibleClusters();
    if (!list.length) {
      render();
      return;
    }
    currentIndex = (currentIndex + delta + list.length) % list.length;
    currentClusterId = list[currentIndex].id;
    render();
  }

  function nextOpen() {
    const list = visibleClusters();
    if (!list.length) {
      render();
      return;
    }
    currentIndex = Math.min(currentIndex, list.length - 1);
    currentClusterId = list[currentIndex].id;
    render();
  }

  function recordTag() {
    const cluster = currentCluster();
    const person = exactPerson(els.personInput.value);
    if (!cluster || !person) return;
    const confirmed = window.confirm(
      "Confirm " + person.name + " for the recurring face in " +
      cluster.photoCount + " photographs?\n\n" +
      "This saves a private local review decision. It does not alter originals or sync live data."
    );
    if (!confirmed) return;
    state.set(cluster.id, { action: "tag", personSlug: person.slug });
    saveState();
    showToast("Saved " + cluster.id + " as " + person.name);
    nextOpen();
  }

  function recordHold() {
    const cluster = currentCluster();
    if (!cluster) return;
    state.set(cluster.id, { action: "hold" });
    saveState();
    showToast("Held " + cluster.id + " for later");
    nextOpen();
  }

  function clearDecision() {
    const cluster = currentCluster();
    if (!cluster) return;
    state.delete(cluster.id);
    saveState();
    showToast("Decision cleared");
    render();
  }

  function exportPayload() {
    return {
      schemaVersion: 1,
      reportFingerprint: data.reportFingerprint,
      exportedAt: new Date().toISOString(),
      decisions: data.clusters.flatMap((cluster) => {
        const decision = state.get(cluster.id);
        return decision
          ? [{ clusterId: cluster.id, ...decision }]
          : [];
      })
    };
  }

  function downloadDecisions() {
    const blob = new Blob(
      [JSON.stringify(exportPayload(), null, 2) + "\n"],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "rachandzach-recurring-face-decisions.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast("Decision file downloaded");
  }

  async function importDecisions(file) {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      window.alert("That file is not valid JSON.");
      return;
    }
    if (
      payload?.schemaVersion !== 1 ||
      payload.reportFingerprint !== data.reportFingerprint ||
      !Array.isArray(payload.decisions)
    ) {
      window.alert("That decision file belongs to a different recurring-face review.");
      return;
    }
    const next = new Map(state);
    for (const decision of payload.decisions) {
      const cluster = data.clusters.find((item) => item.id === decision.clusterId);
      const validTag =
        decision.action === "tag" && peopleBySlug.has(decision.personSlug);
      const validHold = decision.action === "hold";
      if (!cluster || (!validTag && !validHold)) {
        window.alert("The decision file contains an unknown cluster or person.");
        return;
      }
      next.set(
        decision.clusterId,
        validTag
          ? { action: "tag", personSlug: decision.personSlug }
          : { action: "hold" }
      );
    }
    state = next;
    saveState();
    showToast("Decision file restored");
    render();
  }

  for (const button of els.modeButtons) {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      currentIndex = 0;
      currentClusterId = "";
      render();
    });
  }
  els.personInput.addEventListener("input", updatePersonControls);
  els.personInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !els.confirm.disabled) {
      event.preventDefault();
      recordTag();
    }
  });
  els.confirm.addEventListener("click", recordTag);
  els.hold.addEventListener("click", recordHold);
  els.clear.addEventListener("click", clearDecision);
  els.previous.addEventListener("click", () => go(-1));
  els.next.addEventListener("click", () => go(1));
  els.download.addEventListener("click", downloadDecisions);
  els.importButton.addEventListener("click", () => els.importInput.click());
  els.importInput.addEventListener("change", () => {
    const file = els.importInput.files?.[0];
    if (file) void importDecisions(file);
    els.importInput.value = "";
  });
  els.closeContext.addEventListener("click", () => els.contextDialog.close());
  els.contextDialog.addEventListener("click", (event) => {
    if (event.target === els.contextDialog) els.contextDialog.close();
  });
  window.addEventListener("keydown", (event) => {
    if (els.contextDialog.open) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.key === "ArrowLeft") go(-1);
    if (event.key === "ArrowRight") go(1);
  });

  render();
})();
`;

function renderHtml(model) {
  const options = model.people
    .map(
      (person) =>
        `<option value="${person.name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></option>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' data: file:; img-src 'self' data: file:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Recurring unnamed faces · Rach &amp; Zach</title>
  <style>${css}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="heading-row">
        <div>
          <p class="kicker">Private local review</p>
          <h1>Recurring unnamed faces</h1>
        </div>
        <p class="safety">
          ${model.counts.clusters} same-face groups across ${model.counts.photos} photos.
          Originals, embeddings, and similarity suggestions stay out of this page.
        </p>
      </div>
      <div class="progress-row">
        <div class="progress-track" aria-hidden="true">
          <div class="progress-fill" id="progress-fill"></div>
        </div>
        <div class="progress-label" id="progress-label"></div>
      </div>
    </div>
  </header>

  <div class="toolbar">
    <div class="mode-group" role="group" aria-label="Review status">
      <button class="button" type="button" data-mode="open" aria-pressed="true">Open</button>
      <button class="button" type="button" data-mode="all" aria-pressed="false">All</button>
      <button class="button" type="button" data-mode="tagged" aria-pressed="false">Tagged</button>
      <button class="button" type="button" data-mode="held" aria-pressed="false">Held</button>
    </div>
    <div class="toolbar-actions">
      <button class="button quiet" type="button" id="import-decisions">Restore decisions</button>
      <input type="file" id="import-input" accept="application/json,.json" hidden>
      <button class="button primary" type="button" id="download-decisions" disabled>Download decisions</button>
    </div>
  </div>

  <main>
    <div class="review-layout" id="review-layout">
      <section class="panel cluster-panel" aria-labelledby="cluster-title">
        <div class="cluster-heading">
          <div>
            <h2 id="cluster-title"></h2>
            <p class="cluster-copy" id="cluster-copy"></p>
          </div>
          <span class="cluster-number" id="cluster-number"></span>
        </div>
        <div class="face-grid" id="face-grid"></div>
      </section>

      <aside class="panel identity-panel" aria-label="Identity decision">
        <div class="decision-state">
          <span>Decision</span>
          <span class="state-pill" id="state-pill">Open</span>
        </div>
        <div class="reference">
          <div class="reference-face" id="reference-face" aria-hidden="true">?</div>
          <div class="reference-copy">
            <strong id="reference-name">No person selected</strong>
            <p id="reference-copy">Choose any attendee from the complete wedding roster.</p>
          </div>
        </div>
        <div class="person-field">
          <label for="person-input">Who is this?</label>
          <input
            id="person-input"
            type="text"
            list="people-options"
            autocomplete="off"
            placeholder="Start typing a name"
          >
          <datalist id="people-options">${options}</datalist>
          <p class="validation" id="validation"></p>
        </div>
        <div class="decision-actions">
          <button class="button warm" type="button" id="confirm-name" disabled>Confirm name for this cluster</button>
          <button class="button" type="button" id="hold-cluster">Hold — I’m not sure yet</button>
          <button class="button quiet" type="button" id="clear-decision" hidden>Clear saved decision</button>
        </div>
        <div class="nav-actions">
          <button class="button" type="button" id="previous-cluster">← Previous</button>
          <button class="button" type="button" id="next-cluster">Next →</button>
        </div>
      </aside>
    </div>

    <section class="empty" id="empty" hidden>
      <h2 id="empty-title"></h2>
      <p id="empty-copy"></p>
    </section>

    <details class="after-review">
      <summary>What happens after I download the decisions?</summary>
      <p>
        The importer validates the exact face-report fingerprint, every cluster,
        every roster person, every photo path, and duplicate-person conflicts.
        Writing updates only the tracked additive tag overlay and generated local catalog.
        Live sync remains a separate explicit command with a pre-write backup.
      </p>
      <code>npm run faces:recurring:apply -- ~/Downloads/rachandzach-recurring-face-decisions.json --write</code>
      <code>node scripts/sync-catalog-overlays.mjs</code>
      <code>node scripts/sync-catalog-overlays.mjs --execute</code>
    </details>
  </main>

  <dialog id="context-dialog" aria-labelledby="context-title">
    <div class="context-head">
      <strong id="context-title"></strong>
      <button class="button" type="button" id="close-context">Close</button>
    </div>
    <div class="context-photo" id="context-photo">
      <img id="context-image" alt="">
      <span class="context-box" id="context-box" aria-hidden="true"></span>
    </div>
  </dialog>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script type="application/json" id="tagger-data">${jsonScript(model)}</script>
  <script>${clientJs}</script>
</body>
</html>
`;
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function findDerivative(photoId) {
  for (const filename of ["960.webp", "1600.webp", "480.webp"]) {
    const path = join(derivativesRoot, photoId, filename);
    try {
      await fs.access(path);
      return privateFileUrl(path);
    } catch {
      // Try the next existing local preview size.
    }
  }
  return null;
}

async function main() {
  const open = process.argv.includes("--open");
  const unknown = process.argv.slice(2).filter((argument) => argument !== "--open");
  invariant(
    unknown.length === 0,
    `unknown argument ${String(unknown[0])}`,
  );
  const [report, catalog, faceFiles] = await Promise.all([
    readJson(reportPath),
    readJson(catalogPath),
    fs.readdir(committedFacesRoot),
  ]);
  const photoIds = [
    ...new Set(
      report.clusters
        .filter((cluster) => cluster.repeated)
        .flatMap((cluster) =>
          cluster.members.map((member) => member.split(":", 1)[0]),
        ),
    ),
  ];
  const derivativeEntries = await Promise.all(
    photoIds.map(async (photoId) => [photoId, await findDerivative(photoId)]),
  );
  const derivativeUrls = Object.fromEntries(derivativeEntries);
  const faceFileSet = new Set(faceFiles);
  const committedFaceUrls = Object.fromEntries(
    catalog.people.flatMap((person) => {
      const filename = `${person.slug}.webp`;
      return faceFileSet.has(filename)
        ? [[person.slug, privateFileUrl(join(committedFacesRoot, filename))]]
        : [];
    }),
  );
  const model = buildRecurringFaceTaggerModel({
    report,
    catalog,
    derivativeUrls,
    committedFaceUrls,
  });
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, renderHtml(model));
  console.log(
    JSON.stringify(
      {
        output: outputPath,
        recurringClusters: model.counts.clusters,
        faceInstances: model.counts.faces,
        uniquePhotos: model.counts.photos,
        rosterPeople: model.counts.people,
        containsEmbeddings: false,
        containsSimilaritySuggestions: false,
      },
      null,
      2,
    ),
  );
  if (open && process.platform === "darwin") {
    spawn("open", [outputPath], { detached: true, stdio: "ignore" }).unref();
  } else if (open) {
    console.warn(`Open ${pathToFileURL(outputPath).href}`);
  }
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
