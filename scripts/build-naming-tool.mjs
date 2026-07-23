import { promises as fs } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./lib/photo-metadata.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const reviewDir = join(rootDir, "metadata", "identity-review");
const queueFile = join(rootDir, "metadata", "sorted", "unconfirmed-review-queue.csv");
const unresolvedCropsFile = join(reviewDir, "unresolved-crops.csv");
const partialCropsFile = join(reviewDir, "partial-crops.csv");
const peopleFile = join(reviewDir, "people-reference-index.csv");
const outputFile = join(reviewDir, "name-people.html");

function readCsv(text) {
  const [headers = [], ...rows] = parseCsv(text);
  return rows
    .filter((row) => row.some((value) => String(value || "").trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] || ""])));
}

async function readCsvFile(path) {
  return fs.readFile(path, "utf8").then(readCsv).catch(() => []);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function webPath(path) {
  return relative(dirname(outputFile), join(rootDir, path)).split(sep).join("/");
}

function sourceWebPath(path) {
  return `../../../Rachel%20%26%20Zach%20-%20Ali%20Beck%20Photography%202/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function groupByPath(rows) {
  const byPath = new Map();
  for (const row of rows) {
    const list = byPath.get(row.path) || [];
    list.push(row);
    byPath.set(row.path, list);
  }
  return byPath;
}

function numeric(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boxFromRow(row) {
  const x = numeric(row.box_x);
  const y = numeric(row.box_y);
  const width = numeric(row.box_w);
  const height = numeric(row.box_h);
  if ([x, y, width, height].some((value) => value == null)) return null;
  return {
    x,
    y,
    width,
    height,
    area: numeric(row.area),
    appliedWidth: numeric(row.applied_w),
    appliedHeight: numeric(row.applied_h)
  };
}

function splitPeople(value) {
  return String(value || "")
    .split(";")
    .map((person) => person.trim())
    .filter(Boolean);
}

function suggestionSourceName(filename) {
  if (filename === "manual-confirmed-matches.csv") return "manual";
  return filename.replace(/\.csv$/, "").replace(/^identity-review-/, "agent ");
}

async function readSuggestionRows() {
  const files = await fs.readdir(reviewDir).catch(() => []);
  const suggestionFiles = files
    .filter((file) => /^identity-review-\d{2}-\d{2}\.csv$/.test(file) || file === "manual-confirmed-matches.csv")
    .sort();
  const rows = [];
  for (const file of suggestionFiles) {
    const parsed = await readCsvFile(join(reviewDir, file));
    for (const row of parsed) {
      if (!row.path || row.recommendation !== "replace" || !row.people) continue;
      const people = splitPeople(row.people);
      if (!people.length) continue;
      rows.push({
        path: row.path,
        people: people.join("; "),
        confidence: row.confidence || "",
        notes: row.notes || "",
        source: suggestionSourceName(file)
      });
      for (const person of people) {
        rows.push({
          path: row.path,
          people: person,
          confidence: row.confidence || "",
          notes: row.notes || "",
          source: suggestionSourceName(file)
        });
      }
    }
  }
  return rows;
}

function groupSuggestions(rows) {
  const byPath = new Map();
  for (const row of rows) {
    const list = byPath.get(row.path) || [];
    const key = row.people.toLowerCase();
    if (!list.some((item) => item.people.toLowerCase() === key)) list.push(row);
    byPath.set(row.path, list);
  }
  return byPath;
}

const css = String.raw`
  :root {
    --bg: #f8f7f3;
    --surface: #fffdfa;
    --surface-strong: #ffffff;
    --ink-panel: #292d27;
    --line: #ddd8ce;
    --text: #27231e;
    --muted: #706c63;
    --sage: #3f5a49;
    --sage-soft: #e8eee7;
    --terracotta: #a95f4a;
    --gold: #bf9b5f;
    --danger: #8d4d3d;
    --shadow: 0 18px 42px rgba(39, 35, 30, 0.09);
  }
  * { box-sizing: border-box; }
  html {
    background:
      linear-gradient(135deg, rgba(63, 90, 73, 0.10), transparent 34%),
      linear-gradient(180deg, #fbfaf6 0%, var(--bg) 44%, #f3f0ea 100%);
    color: var(--text);
    font-family: Avenir Next, Avenir, Inter, system-ui, sans-serif;
  }
  body { margin: 0; }
  button, input, textarea { font: inherit; }
  button {
    min-height: 40px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    padding: 0 13px;
    font-size: 13px;
    font-weight: 750;
    cursor: pointer;
    transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
  }
  button:hover { border-color: var(--sage); transform: translateY(-1px); }
  button:active { transform: translateY(0); }
  button:disabled {
    cursor: default;
    opacity: 0.42;
  }
  button.primary {
    border-color: var(--sage);
    background: var(--sage);
    color: #fffdfa;
    box-shadow: 0 10px 22px rgba(63, 90, 73, 0.16);
  }
  button.ghost { background: transparent; }
  button.warn {
    border-color: #d9b6aa;
    color: var(--danger);
    background: #fff8f5;
  }
  button.active {
    border-color: var(--sage);
    background: var(--sage-soft);
  }
  header {
    position: sticky;
    top: 0;
    z-index: 6;
    display: grid;
    gap: 12px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--line);
    background: rgba(248, 247, 243, 0.96);
    backdrop-filter: blur(14px);
  }
  .topbar {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 16px;
  }
  .kicker {
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  h1 {
    margin: 2px 0 0;
    font-family: "Iowan Old Style", Georgia, serif;
    font-size: clamp(27px, 4vw, 40px);
    line-height: 1.04;
    font-weight: 500;
    letter-spacing: 0;
  }
  .stats {
    color: var(--muted);
    font-size: 13px;
    font-weight: 750;
    text-align: right;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .progressRail {
    height: 8px;
    overflow: hidden;
    border: 1px solid rgba(63, 90, 73, 0.18);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.72);
  }
  .progressFill {
    width: 0%;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--sage), var(--terracotta), var(--gold));
    transition: width 260ms ease;
  }
  input[type="search"], .nameInput, textarea {
    width: 100%;
    min-height: 42px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface-strong);
    color: var(--text);
    padding: 10px 12px;
  }
  input[type="search"] {
    max-width: 360px;
    flex: 1 1 260px;
  }
  main { padding: 20px 24px 52px; }
  .reviewer {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(330px, 420px);
    gap: 18px;
    align-items: start;
  }
  .stagePanel, .controlPanel {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    box-shadow: var(--shadow);
  }
  .stagePanel { padding: 14px; }
  .photoFrame {
    position: relative;
    width: 100%;
    min-height: 280px;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: 7px;
    background: var(--ink-panel);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
  .photoWrap {
    position: relative;
    display: inline-block;
    max-width: 100%;
    max-height: calc(100vh - 190px);
  }
  .sourceImage {
    display: block;
    width: auto;
    max-width: 100%;
    max-height: calc(100vh - 190px);
    object-fit: contain;
  }
  .faceBox {
    position: absolute;
    display: none;
    border: 3px solid #f6d476;
    border-radius: 6px;
    box-shadow: 0 0 0 9999px rgba(39, 35, 30, 0.25), 0 0 0 1px rgba(39, 35, 30, 0.5), 0 0 22px rgba(246, 212, 118, 0.48);
    pointer-events: none;
    animation: boxPulse 1200ms ease-in-out infinite alternate;
  }
  .faceBox.visible { display: block; }
  .stageMeta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 10px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
  }
  .thumbRow {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-top: 12px;
  }
  .thumbButton {
    width: 76px;
    min-width: 76px;
    height: 76px;
    padding: 0;
    overflow: hidden;
    border-radius: 7px;
    background: #eee6dc;
  }
  .thumbButton.active { outline: 3px solid #f6d476; outline-offset: 1px; }
  .thumbButton img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .controlPanel {
    display: grid;
    gap: 14px;
    padding: 16px;
    position: relative;
  }
  .reviewStatus {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.62);
    padding: 9px 11px;
  }
  .statusText {
    color: var(--muted);
    font-size: 12px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .statusDot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: var(--terracotta);
    box-shadow: 0 0 0 5px rgba(169, 95, 74, 0.10);
  }
  .statusDot.done {
    background: var(--sage);
    box-shadow: 0 0 0 5px rgba(63, 90, 73, 0.12);
  }
  .statusDot.draft {
    background: var(--gold);
    box-shadow: 0 0 0 5px rgba(191, 155, 95, 0.14);
  }
  .itemHeader {
    display: grid;
    gap: 7px;
  }
  .tag {
    display: inline-flex;
    width: fit-content;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 4px 9px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }
  .tag.partial {
    border-color: var(--gold);
    color: #7a5d24;
    background: #fbf4e5;
  }
  .path {
    margin: 0;
    font-size: 17px;
    line-height: 1.25;
    font-weight: 850;
    overflow-wrap: anywhere;
  }
  .note {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
    line-height: 1.35;
  }
  .focusCrop {
    width: 100%;
    max-height: 190px;
    object-fit: contain;
    border-radius: 7px;
    background: #eee6dc;
  }
  .sectionLabel {
    margin: 0 0 7px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .guessList, .matchList, .actionGrid, .navGrid, .quickActionRow {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .guessList button, .matchList button {
    min-height: 34px;
    padding: 0 10px;
    font-size: 12px;
  }
  .guessList button {
    background: #fbf4e5;
    border-color: #dfc58e;
  }
  .guessList button strong { font-weight: 850; }
  .validationText {
    min-height: 18px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 750;
  }
  .validationText.warn { color: var(--danger); }
  .nameBlock {
    display: grid;
    gap: 8px;
  }
  .nameRow {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  textarea {
    min-height: 76px;
    resize: vertical;
  }
  .referencePanel {
    display: none;
    gap: 8px;
  }
  .referencePanel.visible { display: grid; }
  .referencePanel img {
    width: 100%;
    max-height: 250px;
    object-fit: contain;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: #eee6dc;
  }
  .exportBox {
    width: 100%;
    min-height: 150px;
    margin-top: 18px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
  .emptyState {
    display: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    padding: 26px;
    color: var(--muted);
    font-weight: 750;
  }
  .emptyState.visible { display: block; }
  [hidden] { display: none !important; }
  .toast {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 10;
    transform: translateY(16px);
    opacity: 0;
    border: 1px solid rgba(63, 90, 73, 0.22);
    border-radius: 999px;
    background: #fffdfa;
    box-shadow: var(--shadow);
    padding: 11px 15px;
    color: var(--sage);
    font-size: 13px;
    font-weight: 850;
    transition: opacity 160ms ease, transform 160ms ease;
    pointer-events: none;
  }
  .toast.visible {
    opacity: 1;
    transform: translateY(0);
  }
  @keyframes boxPulse {
    from { outline: 0 solid rgba(246, 212, 118, 0); }
    to { outline: 6px solid rgba(246, 212, 118, 0.18); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  @media (max-width: 980px) {
    header, main { padding-left: 14px; padding-right: 14px; }
    h1 { font-size: clamp(29px, 8vw, 36px); }
    .topbar { align-items: start; flex-direction: column; }
    .stats { text-align: left; overflow-wrap: anywhere; }
    .reviewer { grid-template-columns: 1fr; }
    .photoWrap, .sourceImage { max-height: 40vh; }
  }
`;

const clientJs = String.raw`
(() => {
  const data = JSON.parse(document.getElementById("review-data").textContent);
  const items = data.items;
  const knownPeople = data.people;
  const referenceByPerson = new Map(Object.entries(data.referenceByPerson));
  const storageKey = "rzIdentityReviewV2";
  const stateVersionKey = "rzIdentityReviewStateVersion";
  const stateVersion = "draft-save-v3";
  const backupKey = storageKey + "BackupBeforeDraftFix";
  const existingState = localStorage.getItem(storageKey);
  let resetNotice = false;
  if (existingState && localStorage.getItem(stateVersionKey) !== stateVersion) {
    localStorage.setItem(backupKey, existingState);
    localStorage.removeItem(storageKey);
    resetNotice = true;
  }
  localStorage.setItem(stateVersionKey, stateVersion);
  const state = new Map(JSON.parse(localStorage.getItem(storageKey) || "[]"));
  const drafts = new Map();
  let mode = "open";
  let currentIndex = 0;
  let currentKey = "";
  let lastAction = null;

  const els = {
    filter: document.getElementById("filter"),
    progress: document.getElementById("progress"),
    progressFill: document.getElementById("progressFill"),
    counter: document.getElementById("counter"),
    modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
    reviewer: document.getElementById("reviewer"),
    empty: document.getElementById("emptyState"),
    sourceImage: document.getElementById("sourceImage"),
    faceBox: document.getElementById("faceBox"),
    focusMode: document.getElementById("focusMode"),
    thumbRow: document.getElementById("thumbRow"),
    itemType: document.getElementById("itemType"),
    itemPath: document.getElementById("itemPath"),
    itemNotes: document.getElementById("itemNotes"),
    existingPeople: document.getElementById("existingPeople"),
    statusText: document.getElementById("statusText"),
    statusDot: document.getElementById("statusDot"),
    focusCrop: document.getElementById("focusCrop"),
    acceptGuess: document.getElementById("acceptGuess"),
    guessList: document.getElementById("guessList"),
    matchList: document.getElementById("matchList"),
    nameInput: document.getElementById("nameInput"),
    validationText: document.getElementById("validationText"),
    notesInput: document.getElementById("notesInput"),
    referencePanel: document.getElementById("referencePanel"),
    referenceLabel: document.getElementById("referenceLabel"),
    referenceImage: document.getElementById("referenceImage"),
    prev: document.getElementById("prevItem"),
    next: document.getElementById("nextItem"),
    nextOpen: document.getElementById("nextOpen"),
    saveNext: document.getElementById("saveNext"),
    ignoreNext: document.getElementById("ignoreNext"),
    unknownNext: document.getElementById("unknownNext"),
    undoAction: document.getElementById("undoAction"),
    exportCsv: document.getElementById("exportCsv"),
    downloadCsv: document.getElementById("downloadCsv"),
    csvOutput: document.getElementById("csvOutput"),
    toast: document.getElementById("toast")
  };
  let toastTimer = null;

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify([...state.entries()]));
  }

  function defaultRecord() {
    return { action: "needs_identity", people: "", notes: "" };
  }

  function findItemByKey(key) {
    return items.find((item) => item.key === key) || null;
  }

  function getRecord(item) {
    return state.get(item.key) || (item.legacyKey ? state.get(item.legacyKey) : null) || defaultRecord();
  }

  function getDraft(item) {
    return drafts.get(item.key) || getRecord(item);
  }

  function hasDraft(item) {
    if (!drafts.has(item.key)) return false;
    const draft = getDraft(item);
    const saved = getRecord(item);
    return draft.action !== saved.action || draft.people !== saved.people || draft.notes !== saved.notes;
  }

  function setDraft(item, patch) {
    drafts.set(item.key, Object.assign({}, getDraft(item), patch));
  }

  function setRecord(item, patch, options = {}) {
    const track = options.track !== false;
    const hadPrevious = state.has(item.key);
    const previous = hadPrevious ? Object.assign({}, state.get(item.key)) : null;
    const next = Object.assign({}, getRecord(item), patch);
    if (track) lastAction = { key: item.key, hadPrevious, previous };
    state.set(item.key, next);
    drafts.delete(item.key);
    saveState();
    updateProgress();
    updateUndo();
  }

  function showToast(text) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 900);
  }

  function nameValidation(value) {
    const parts = String(value || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return { valid: false, message: "Add a name or ignore this face" };
    const badPart = parts.find((part) => {
      const exactKnown = knownPeople.some((person) => person.toLowerCase() === part.toLowerCase());
      return !exactKnown && part.length < 3;
    });
    if (badPart) return { valid: false, message: "That name looks too short to save" };
    return { valid: true, message: "Ready to save" };
  }

  function isDone(item) {
    const record = getRecord(item);
    return record.action === "ignore" || (record.action === item.namedAction && nameValidation(record.people).valid);
  }

  function updateDraftControls(item) {
    const validation = nameValidation(els.nameInput.value);
    const draft = hasDraft(item);
    els.saveNext.disabled = !validation.valid;
    els.validationText.textContent = draft || els.nameInput.value.trim() ? validation.message : "";
    els.validationText.classList.toggle("warn", !validation.valid && Boolean(els.nameInput.value.trim()));
    if (draft) {
      els.statusText.textContent = "Draft";
      els.statusDot.className = "statusDot draft";
    } else {
      const saved = getRecord(item);
      const done = isDone(item);
      els.statusText.textContent = done ? (saved.action === "ignore" ? "Ignored" : "Saved") : "Open";
      els.statusDot.className = "statusDot" + (done ? " done" : "");
    }
  }

  function updateUndo() {
    els.undoAction.disabled = !lastAction;
  }

  function undoLastAction() {
    if (!lastAction) {
      showToast("Nothing to undo");
      return;
    }
    if (lastAction.hadPrevious) state.set(lastAction.key, lastAction.previous);
    else state.delete(lastAction.key);
    drafts.delete(lastAction.key);
    lastAction = null;
    saveState();
    updateProgress();
    updateUndo();
    renderCurrent();
    showToast("Undone");
  }

  function visibleItems() {
    const filter = els.filter.value.trim().toLowerCase();
    return items.filter((item) => {
      const done = isDone(item);
      if (mode === "open" && done) return false;
      if (mode === "done" && !done) return false;
      if (mode === "missing" && item.kind !== "missing") return false;
      if (mode === "partial" && item.kind !== "partial") return false;
      if (!filter) return true;
      const record = getRecord(item);
      const haystack = [
        item.path,
        item.notes,
        item.existingPeople,
        item.faceIndex,
        record.people,
        record.notes,
        item.guesses.map((guess) => guess.people).join(" ")
      ].join(" ").toLowerCase();
      return haystack.includes(filter);
    });
  }

  function csvEscape(value) {
    const text = String(value || "");
    return /[",\n]/.test(text) ? "\"" + text.replace(/"/g, "\"\"") + "\"" : text;
  }

  function buildCsvRows() {
    const rows = [["review_kind", "path", "face_index", "recommendation", "people", "confidence", "notes"]];
    for (const item of items) {
      const record = getRecord(item);
      if (!isDone(item)) continue;
      rows.push([
        item.kind,
        item.path,
        item.faceIndex || "",
        record.action,
        record.action === item.namedAction ? record.people.trim() : "",
        "user_confirmed",
        record.notes || ""
      ]);
    }
    return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
  }

  function normalizedName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function likelyNames(text) {
    const normalized = normalizedName(text);
    if (!normalized) return [];
    return knownPeople
      .filter((person) => person.toLowerCase().includes(normalized) || normalized.includes(person.toLowerCase()))
      .slice(0, 10);
  }

  function createButton(text, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (className) button.className = className;
    button.addEventListener("click", onClick);
    return button;
  }

  function currentItem() {
    return findItemByKey(currentKey) || visibleItems()[currentIndex] || null;
  }

  function pickItemIndex(list) {
    if (!list.length) return 0;
    const existing = list.findIndex((item) => item.key === currentKey);
    if (existing >= 0) return existing;
    return Math.min(currentIndex, list.length - 1);
  }

  function renderBox(item) {
    if (!item.box) {
      els.faceBox.classList.remove("visible");
      return;
    }
    els.faceBox.style.left = (item.box.x * 100).toFixed(3) + "%";
    els.faceBox.style.top = (item.box.y * 100).toFixed(3) + "%";
    els.faceBox.style.width = (item.box.width * 100).toFixed(3) + "%";
    els.faceBox.style.height = (item.box.height * 100).toFixed(3) + "%";
    els.faceBox.classList.add("visible");
  }

  function setNamed(item, people, advance) {
    els.nameInput.value = people;
    setDraft(item, { action: item.namedAction, people: people, notes: els.notesInput.value });
    updateReference(people);
    if (advance) goNextOpen();
    else {
      renderMatches(item);
      updateDraftControls(item);
      updateProgress();
    }
  }

  function updateReference(value) {
    const firstName = String(value || "").split(";").map((part) => part.trim()).find(Boolean);
    const match = knownPeople.find((person) => person.toLowerCase() === String(firstName || "").toLowerCase());
    const reference = match ? referenceByPerson.get(match) : "";
    if (!reference) {
      els.referencePanel.classList.remove("visible");
      els.referenceImage.removeAttribute("src");
      return;
    }
    els.referenceLabel.textContent = "Reference: " + match;
    els.referenceImage.src = reference;
    els.referencePanel.classList.add("visible");
  }

  function renderGuesses(item) {
    els.guessList.innerHTML = "";
    if (!item.guesses.length) {
      const empty = document.createElement("p");
      empty.className = "note";
      empty.textContent = "No saved guess for this face.";
      els.guessList.append(empty);
      return;
    }
    for (const guess of item.guesses.slice(0, 8)) {
      const label = guess.confidence ? guess.people + " (" + guess.confidence + ")" : guess.people;
      const button = createButton(label, "", () => setNamed(item, guess.people, false));
      button.title = [guess.source, guess.notes].filter(Boolean).join(": ");
      els.guessList.append(button);
    }
  }

  function renderMatches(item) {
    els.matchList.innerHTML = "";
    const typed = els.nameInput.value.trim();
    const names = likelyNames(typed);
    for (const name of names) {
      els.matchList.append(createButton(name, "ghost", () => setNamed(item, name, false)));
    }
  }

  function renderThumbs(item) {
    els.thumbRow.innerHTML = "";
    if (!item.relatedFaces.length || item.relatedFaces.length === 1) return;
    for (const face of item.relatedFaces) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumbButton" + (face.key === item.key ? " active" : "");
      button.title = "Face " + face.faceIndex;
      const img = document.createElement("img");
      img.src = face.crop;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      button.append(img);
      button.addEventListener("click", () => {
        const list = visibleItems();
        const nextIndex = list.findIndex((candidate) => candidate.key === face.key);
        if (nextIndex >= 0) {
          currentIndex = nextIndex;
          renderCurrent();
        }
      });
      els.thumbRow.append(button);
    }
  }

  function updateProgress() {
    let done = 0;
    let missingDone = 0;
    let partialDone = 0;
    for (const item of items) {
      const itemDone = isDone(item);
      if (itemDone) done += 1;
      if (item.kind === "missing" && itemDone) missingDone += 1;
      if (item.kind === "partial" && itemDone) partialDone += 1;
    }
    const list = visibleItems();
    els.progress.textContent =
      done + "/" + items.length + " resolved | " +
      missingDone + "/" + data.counts.missing + " missing | " +
      partialDone + "/" + data.counts.partial + " extra";
    els.progressFill.style.width = items.length ? ((done / items.length) * 100).toFixed(2) + "%" : "0%";
    els.counter.textContent = list.length ? (currentIndex + 1) + " of " + list.length : "0 of 0";
  }

  function renderCurrent() {
    const list = visibleItems();
    currentIndex = pickItemIndex(list);
    const item = list[currentIndex] || null;
    for (const button of els.modeButtons) button.classList.toggle("active", button.dataset.mode === mode);
    if (!item) {
      els.reviewer.style.display = "none";
      els.empty.classList.add("visible");
      updateProgress();
      return;
    }

    currentKey = item.key;
    els.reviewer.style.display = "";
    els.empty.classList.remove("visible");
    const record = getDraft(item);
    const typeLabel = item.kind === "partial" ? "Extra face on tagged photo" : "Missing-tag face";
    els.itemType.textContent = typeLabel;
    els.itemType.className = "tag" + (item.kind === "partial" ? " partial" : "");
    els.itemPath.textContent = item.id + " / face " + item.faceIndex + " / " + item.path;
    els.itemNotes.textContent = item.notes || "";
    els.existingPeople.textContent = item.existingPeople ? "Already tagged: " + item.existingPeople : "";
    els.existingPeople.style.display = item.existingPeople ? "" : "none";
    els.focusMode.textContent = item.box ? "Face selected" : "Full photo";
    const topGuess = item.guesses[0] || null;
    els.acceptGuess.hidden = !topGuess;
    els.acceptGuess.textContent = topGuess ? "Accept " + topGuess.people : "Accept guess";
    els.sourceImage.src = item.source;
    els.focusCrop.src = item.focusCrop;
    els.focusCrop.alt = "Face " + item.faceIndex;
    els.nameInput.value = record.action === item.namedAction ? record.people : "";
    els.notesInput.value = record.notes || "";
    renderBox(item);
    renderThumbs(item);
    renderGuesses(item);
    renderMatches(item);
    updateReference(els.nameInput.value || (item.guesses[0] && item.guesses[0].people) || "");
    updateDraftControls(item);
    updateProgress();
    updateUndo();

    els.prev.disabled = currentIndex <= 0;
    els.next.disabled = currentIndex >= list.length - 1;
  }

  function go(delta) {
    const list = visibleItems();
    if (!list.length) return;
    currentIndex = Math.max(0, Math.min(list.length - 1, currentIndex + delta));
    currentKey = list[currentIndex].key;
    renderCurrent();
  }

  function goNextOpen() {
    const list = visibleItems();
    if (!list.length) return renderCurrent();
    const start = mode === "open" ? currentIndex : Math.min(currentIndex + 1, list.length - 1);
    const nextOpen = list.findIndex((item, index) => index >= start && !isDone(item));
    if (nextOpen >= 0) currentIndex = nextOpen;
    else currentIndex = Math.min(start, list.length - 1);
    const next = visibleItems()[currentIndex];
    currentKey = next ? next.key : "";
    renderCurrent();
  }

  els.filter.addEventListener("input", () => {
    currentIndex = 0;
    renderCurrent();
  });
  for (const button of els.modeButtons) {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      currentIndex = 0;
      renderCurrent();
    });
  }
  els.prev.addEventListener("click", () => go(-1));
  els.next.addEventListener("click", () => go(1));
  els.nextOpen.addEventListener("click", goNextOpen);
  els.acceptGuess.addEventListener("click", () => {
    const item = currentItem();
    const guess = item && item.guesses[0];
    if (!item || !guess) return;
    setRecord(item, { action: item.namedAction, people: guess.people, notes: els.notesInput.value });
    showToast("Accepted " + guess.people);
    goNextOpen();
  });
  els.nameInput.addEventListener("input", () => {
    const item = currentItem();
    if (!item) return;
    setDraft(item, {
      action: els.nameInput.value.trim() ? item.namedAction : "needs_identity",
      people: els.nameInput.value,
      notes: els.notesInput.value
    });
    renderMatches(item);
    updateReference(els.nameInput.value);
    updateDraftControls(item);
  });
  els.notesInput.addEventListener("input", () => {
    const item = currentItem();
    if (!item) return;
    const draft = getDraft(item);
    setDraft(item, { notes: els.notesInput.value, people: draft.people, action: draft.action });
    updateDraftControls(item);
  });
  els.saveNext.addEventListener("click", () => {
    const item = currentItem();
    if (!item) return;
    const people = els.nameInput.value.trim();
    if (!people) {
      showToast("Add a name or ignore");
      return;
    }
    setRecord(item, { action: item.namedAction, people, notes: els.notesInput.value });
    showToast("Saved");
    goNextOpen();
  });
  els.ignoreNext.addEventListener("click", () => {
    const item = currentItem();
    if (!item) return;
    setRecord(item, { action: "ignore", people: "", notes: els.notesInput.value || "background-only or not useful" });
    showToast("Ignored");
    goNextOpen();
  });
  els.unknownNext.addEventListener("click", () => {
    const item = currentItem();
    if (!item) return;
    setRecord(item, { action: "needs_identity", people: "", notes: els.notesInput.value });
    go(1);
  });
  els.undoAction.addEventListener("click", undoLastAction);
  els.exportCsv.addEventListener("click", () => {
    els.csvOutput.value = buildCsvRows();
  });
  els.downloadCsv.addEventListener("click", () => {
    const csv = buildCsvRows();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "user-identity-review.csv";
    a.click();
    URL.revokeObjectURL(url);
  });
  document.addEventListener("keydown", (event) => {
    if (event.target && ["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (event.key === "ArrowLeft") go(-1);
    if (event.key === "ArrowRight") go(1);
  });

  renderCurrent();
  if (resetNotice) showToast("Reset bad autosaves");
})();
`;

async function main() {
  const [queueRows, unresolvedCropRows, partialCropRows, personRows, suggestionRows] = await Promise.all([
    readCsvFile(queueFile),
    readCsvFile(unresolvedCropsFile),
    readCsvFile(partialCropsFile),
    readCsvFile(peopleFile),
    readSuggestionRows()
  ]);

  const unresolvedCropsByPath = groupByPath(unresolvedCropRows);
  const queueByPath = new Map(queueRows.map((row) => [row.path, row]));
  const suggestionsByPath = groupSuggestions(suggestionRows);
  const people = personRows.map((row) => row.person).filter(Boolean).sort((a, b) => a.localeCompare(b));
  const referenceByPerson = Object.fromEntries(
    personRows
      .filter((row) => row.person && row.sheet)
      .map((row) => [row.person, webPath(row.sheet)])
  );

  const unresolvedItems = [];
  for (const row of queueRows) {
    const crops = unresolvedCropsByPath.get(row.path) || [];
    const relatedFaces = crops.map((crop) => ({
      key: `missing:${row.path}:${crop.face_index}`,
      faceIndex: crop.face_index,
      crop: webPath(crop.crop)
    }));
    for (const crop of crops) {
      unresolvedItems.push({
        key: `missing:${row.path}:${crop.face_index}`,
        legacyKey: `missing:${row.path}`,
        kind: "missing",
        namedAction: "replace",
        id: `${crop.review_id}${crop.face_index && crop.face_index !== "full" ? `.${crop.face_index}` : ""}`,
        path: row.path,
        event: row.event,
        filename: row.filename,
        faceIndex: crop.face_index || "full",
        notes: crop.notes || row.notes || "",
        existingPeople: "",
        source: sourceWebPath(row.path),
        focusCrop: webPath(crop.crop),
        box: boxFromRow(crop),
        guesses: suggestionsByPath.get(row.path) || [],
        relatedFaces
      });
    }
  }

  const partialItems = partialCropRows.map((row, index) => ({
    key: `partial:${row.path}:${row.face_index}`,
    legacyKey: "",
    kind: "partial",
    namedAction: "add",
    id: row.review_id || `P${String(index + 1).padStart(3, "0")}`,
    path: row.path,
    event: row.path.split("/")[0] || "",
    filename: row.path.split("/").pop() || "",
    faceIndex: row.face_index,
    notes: row.notes || "",
    existingPeople: row.existing_people || "",
    source: sourceWebPath(row.path),
    focusCrop: webPath(row.crop),
    box: boxFromRow(row),
    guesses: suggestionsByPath.get(row.path) || [],
    relatedFaces: [{
      key: `partial:${row.path}:${row.face_index}`,
      faceIndex: row.face_index,
      crop: webPath(row.crop)
    }]
  }));

  const items = [...unresolvedItems, ...partialItems].filter((item) => {
    const queueRow = queueByPath.get(item.path);
    return item.kind === "partial" || queueRow || item.path;
  });
  items.sort((a, b) => {
    const guessDelta = Number(b.guesses.length > 0) - Number(a.guesses.length > 0);
    if (guessDelta) return guessDelta;
    const boxDelta = Number(Boolean(b.box)) - Number(Boolean(a.box));
    if (boxDelta) return boxDelta;
    const kindDelta = a.kind.localeCompare(b.kind);
    if (kindDelta) return kindDelta;
    return a.path.localeCompare(b.path) || String(a.faceIndex).localeCompare(String(b.faceIndex));
  });

  const data = {
    items,
    people,
    referenceByPerson,
    counts: {
      missing: unresolvedItems.length,
      partial: partialItems.length
    }
  };

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rachel & Zach Identity Review</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <div class="kicker">Identity review</div>
        <h1>Name one face at a time</h1>
      </div>
      <div class="stats" id="progress"></div>
    </div>
    <div class="toolbar">
      <input id="filter" type="search" placeholder="Filter names, paths, notes">
      <button type="button" data-mode="open">Open</button>
      <button type="button" data-mode="all">All</button>
      <button type="button" data-mode="missing">Missing-tag faces</button>
      <button type="button" data-mode="partial">Extra faces</button>
      <button type="button" data-mode="done">Done</button>
      <button id="exportCsv" class="primary" type="button">Export CSV</button>
      <button id="downloadCsv" type="button">Download CSV</button>
    </div>
    <div class="progressRail" aria-hidden="true"><div class="progressFill" id="progressFill"></div></div>
  </header>
  <main>
    <section class="reviewer" id="reviewer">
      <div class="stagePanel">
        <div class="photoFrame">
          <div class="photoWrap">
            <img class="sourceImage" id="sourceImage" alt="" decoding="async">
            <div class="faceBox" id="faceBox"></div>
          </div>
        </div>
        <div class="stageMeta">
          <span id="counter"></span>
          <span id="focusMode"></span>
        </div>
        <div class="thumbRow" id="thumbRow"></div>
      </div>
      <aside class="controlPanel">
        <div class="reviewStatus">
          <span class="statusText" id="statusText">Open</span>
          <span class="statusDot" id="statusDot"></span>
        </div>
        <div class="itemHeader">
          <span class="tag" id="itemType"></span>
          <p class="path" id="itemPath"></p>
          <p class="note" id="existingPeople"></p>
          <p class="note" id="itemNotes"></p>
        </div>
        <img class="focusCrop" id="focusCrop" alt="" loading="eager" decoding="async">
        <section>
          <p class="sectionLabel">Guesses</p>
          <div class="quickActionRow">
            <button type="button" class="primary" id="acceptGuess" hidden>Accept guess</button>
          </div>
          <div class="guessList" id="guessList"></div>
        </section>
        <section class="nameBlock">
          <p class="sectionLabel">Name</p>
          <div class="nameRow">
            <input class="nameInput" id="nameInput" list="knownPeople" placeholder="Name or semicolon-separated names">
            <button type="button" class="primary" id="saveNext">Save &amp; next</button>
          </div>
          <div class="matchList" id="matchList"></div>
          <div class="validationText" id="validationText"></div>
          <textarea id="notesInput" placeholder="Notes"></textarea>
        </section>
        <section class="referencePanel" id="referencePanel">
          <p class="sectionLabel" id="referenceLabel"></p>
          <img id="referenceImage" alt="" loading="lazy" decoding="async">
        </section>
        <div class="actionGrid">
          <button type="button" class="warn" id="ignoreNext">Ignore / background</button>
          <button type="button" id="unknownNext">Still unknown</button>
          <button type="button" id="nextOpen">Next open</button>
          <button type="button" id="undoAction" disabled>Undo</button>
        </div>
        <div class="navGrid">
          <button type="button" id="prevItem">Previous</button>
          <button type="button" id="nextItem">Next</button>
        </div>
      </aside>
    </section>
    <div class="emptyState" id="emptyState">No review items match the current filters.</div>
    <textarea class="exportBox" id="csvOutput" spellcheck="false" placeholder="Exported CSV will appear here."></textarea>
  </main>
  <div class="toast" id="toast">Saved</div>
  <datalist id="knownPeople">
    ${people.map((person) => `<option value="${htmlEscape(person)}"></option>`).join("\n    ")}
  </datalist>
  <script type="application/json" id="review-data">${jsonScript(data)}</script>
  <script>${clientJs}</script>
</body>
</html>`;

  await fs.writeFile(outputFile, html);
  console.log(`Wrote ${relative(rootDir, outputFile)}`);
  console.log(`Missing-tag review face items: ${unresolvedItems.length}`);
  console.log(`Extra-face review items: ${partialItems.length}`);
  console.log(`Agent/manual guess rows: ${suggestionRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
