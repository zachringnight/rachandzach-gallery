/**
 * Applies naming-session decisions to the tracked decision records.
 *
 * Every write goes through `writeJsonAtomic`: a temporary file in the same
 * directory, fsynced, then renamed over the target. An interrupted write can
 * therefore leave the previous file intact but never a half-written one.
 *
 * Nothing here opens, moves, or rewrites a wedding original or the clean
 * master. It touches exactly three files, all under `metadata/`:
 *   - reviewed-face-tag-additions.json   (names added)
 *   - reviewed-face-tag-removals.json    (a wrong name taken off)
 *   - identity-review/naming-decisions.json (the session's own ledger, which
 *     is what remembers "not a guest" and "not sure")
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { applyCatalogOverlays } from "./catalog-overlays.mjs";

export const CONFIRMATION_KIND = "human-face-naming";
export const REVIEW_TYPE = "Human identity assignment from the local face-naming session";
const REVIEW_METHOD =
  "Rachel named each face herself while looking at the photograph, with Zach present. " +
  "The tool never proposed an identity and no model score was consulted, so these " +
  "assignments do not depend on face similarity. Faces that look alike were shown " +
  "together so one identification could cover the photographs it was made from.";

export class DecisionError extends Error {}

function invariant(condition, message) {
  if (!condition) throw new DecisionError(message);
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== null) return fallback;
    throw error;
  }
}

/** Temp file in the same directory, fsync, rename. Never a partial target. */
export async function writeJsonAtomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(temporary, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, path);
  const directory = await fs.open(dirname(path), "r").catch(() => null);
  if (directory) {
    await directory.sync().catch(() => {});
    await directory.close();
  }
}

export function paths(repoRoot) {
  return {
    additions: join(repoRoot, "metadata", "reviewed-face-tag-additions.json"),
    removals: join(repoRoot, "metadata", "reviewed-face-tag-removals.json"),
    ledger: join(repoRoot, "metadata", "identity-review", "naming-decisions.json"),
    catalog: join(repoRoot, "src", "generated", "gallery-v2.json"),
    attendees: join(repoRoot, "metadata", "wedding-attendees.json"),
    backups: join(repoRoot, "metadata", "identity-review", "backups"),
  };
}

/**
 * One-time copy of each decision record before the session touches anything,
 * so there is always a known-good file to fall back to.
 */
export async function backupDecisionFiles(repoRoot) {
  const file = paths(repoRoot);
  await fs.mkdir(file.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const made = [];
  for (const [name, source] of [
    ["reviewed-face-tag-additions.json", file.additions],
    ["reviewed-face-tag-removals.json", file.removals],
    ["naming-decisions.json", file.ledger],
  ]) {
    const target = join(file.backups, `${stamp}--${name}`);
    try {
      await fs.copyFile(source, target);
      made.push(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return made;
}

function findOrCreateWave(source, fingerprint) {
  const existing = (source.reviewWaves ?? []).find(
    (wave) => wave.reviewType === REVIEW_TYPE && wave.auditFingerprint === fingerprint,
  );
  if (existing) {
    invariant(
      existing.manualConfirmation === true,
      "the existing naming-session review wave is not marked human-confirmed",
    );
    return existing;
  }
  const wave = {
    wave: Math.max(0, ...(source.reviewWaves ?? []).map((w) => Number(w.wave) || 0)) + 1,
    auditFingerprint: fingerprint,
    reviewType: REVIEW_TYPE,
    reviewMethod: REVIEW_METHOD,
    manualConfirmation: true,
    candidatesReviewed: 0,
    candidatesApproved: 0,
    candidatesRejected: 0,
  };
  source.reviewWaves = [...(source.reviewWaves ?? []), wave];
  return wave;
}

function refreshCounts(manifest, wave, fingerprint, reviewedAt) {
  const mine = manifest.additions.filter(
    (addition) =>
      addition.confirmationKind === CONFIRMATION_KIND && addition.reviewWave === wave.wave,
  );
  wave.candidatesReviewed = mine.length;
  wave.candidatesApproved = mine.length;
  wave.candidatesRejected = 0;

  const fingerprints = new Set(manifest.source.auditFingerprints ?? []);
  fingerprints.add(fingerprint);
  manifest.source.auditFingerprints = [...fingerprints];
  manifest.source.auditFingerprint = fingerprint;
  manifest.source.reviewedAt = reviewedAt;
  if (!String(manifest.source.reviewedBy).includes("Rachel")) {
    manifest.source.reviewedBy = `${manifest.source.reviewedBy} + Rachel face naming session`;
  }
  if (!String(manifest.source.reviewMethod).includes("Rachel named each face")) {
    manifest.source.reviewMethod = `${manifest.source.reviewMethod} ${REVIEW_METHOD}`;
  }
  // validateFaceTags requires these to agree with the list.
  manifest.source.candidatesApproved = manifest.additions.length;
  manifest.source.candidatesReviewed =
    manifest.additions.length + Number(manifest.source.candidatesRejected ?? 0);
}

/**
 * A session that owns the decision files for as long as it runs. All writes go
 * through `apply`, which is serialized, validated against the catalog before
 * anything reaches disk, and reversible.
 */
export class NamingSession {
  constructor({ repoRoot, model, catalog, attendees, additions, removals, ledger }) {
    this.repoRoot = repoRoot;
    this.paths = paths(repoRoot);
    this.model = model;
    this.catalog = catalog;
    this.attendees = attendees;
    this.additions = additions;
    this.removals = removals;
    this.ledger = ledger;
    this.itemByKey = new Map(model.items.map((item) => [item.key, item]));
    this.personBySlug = new Map(model.roster.map((person) => [person.slug, person]));
    this.undoStack = [];
    this.queue = Promise.resolve();
  }

  static async open({ repoRoot, model }) {
    const file = paths(repoRoot);
    const [catalog, attendees, additions, removals, ledger] = await Promise.all([
      readJson(file.catalog),
      readJson(file.attendees),
      readJson(file.additions),
      readJson(file.removals, { schemaVersion: 1, source: {}, removals: [] }),
      readJson(file.ledger, { schemaVersion: 1, updatedAt: null, entries: {} }),
    ]);
    invariant(additions?.schemaVersion === 1, "reviewed-face-tag-additions.json is not schema 1");
    invariant(Array.isArray(additions.additions), "reviewed-face-tag-additions.json has no additions");
    invariant(removals?.schemaVersion === 1, "reviewed-face-tag-removals.json is not schema 1");
    return new NamingSession({ repoRoot, model, catalog, attendees, additions, removals, ledger });
  }

  decidedSnapshot() {
    const out = {};
    for (const [key, value] of Object.entries(this.ledger.entries || {})) {
      if (this.itemByKey.has(key)) out[key] = value;
    }
    return out;
  }

  /** Serialize every mutation; a second request waits rather than interleaves. */
  run(task) {
    const next = this.queue.then(task, task);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  apply(request) {
    return this.run(() => this.#applyNow(request));
  }

  undo() {
    return this.run(() => this.#undoNow());
  }

  setNote({ key, note }) {
    return this.run(async () => {
      const entry = (this.ledger.entries || {})[key];
      invariant(entry, "that face has no answer to add a note to");
      const before = JSON.parse(JSON.stringify(this.ledger));
      entry.note = String(note || "").slice(0, 400);
      this.ledger.updatedAt = new Date().toISOString();
      await writeJsonAtomic(this.paths.ledger, this.ledger);
      this.undoStack.push({
        label: "note",
        keys: [key],
        ledger: before,
        additions: null,
        removals: null,
      });
      return { decided: { [key]: entry }, undoDepth: this.undoStack.length };
    });
  }

  async #applyNow({ keys, action, personSlugs, note }) {
    invariant(Array.isArray(keys) && keys.length > 0, "no faces were selected");
    const items = keys.map((key) => {
      const item = this.itemByKey.get(key);
      invariant(item, `unknown face ${key}`);
      return item;
    });
    invariant(
      ["tag", "not-a-guest", "skip", "too-blurry", "remove", "reopen"].includes(action),
      `unknown action ${action}`,
    );

    const before = {
      additions: JSON.parse(JSON.stringify(this.additions)),
      removals: JSON.parse(JSON.stringify(this.removals)),
      ledger: JSON.parse(JSON.stringify(this.ledger)),
    };

    try {
      if (action === "tag") this.#tag(items, personSlugs);
      if (action === "remove") this.#remove(items, personSlugs, note);
      if (action === "reopen") this.#reopen(items);

      const decidedAt = new Date().toISOString();
      this.ledger.entries = this.ledger.entries || {};
      for (const item of items) {
        if (action === "reopen") delete this.ledger.entries[item.key];
        else {
          this.ledger.entries[item.key] = {
            action,
            personSlugs: action === "tag" || action === "remove" ? [...personSlugs] : [],
            note: String(note || "").slice(0, 400),
            decidedAt,
          };
        }
      }
      this.ledger.updatedAt = decidedAt;
      this.ledger.schemaVersion = 1;

      // Fail before touching disk, not after: a copy of the catalog takes the
      // full overlay pass, so an addition that would break the catalog is
      // rejected while the files on disk are still the old, valid ones.
      this.#validate();

      await writeJsonAtomic(this.paths.additions, this.additions);
      await writeJsonAtomic(this.paths.removals, this.removals);
      await writeJsonAtomic(this.paths.ledger, this.ledger);
    } catch (error) {
      this.additions = before.additions;
      this.removals = before.removals;
      this.ledger = before.ledger;
      throw error;
    }

    this.undoStack.push({ label: action, keys, ...before });
    const decided = {};
    for (const item of items) decided[item.key] = this.ledger.entries[item.key] ?? null;
    return { decided, undoDepth: this.undoStack.length };
  }

  async #undoNow() {
    const last = this.undoStack.pop();
    if (!last) return { decided: {}, undoDepth: 0, reverted: 0 };
    this.additions = last.additions ?? this.additions;
    this.removals = last.removals ?? this.removals;
    this.ledger = last.ledger;
    this.#validate();
    await writeJsonAtomic(this.paths.additions, this.additions);
    await writeJsonAtomic(this.paths.removals, this.removals);
    await writeJsonAtomic(this.paths.ledger, this.ledger);
    const decided = {};
    for (const key of last.keys) decided[key] = (this.ledger.entries || {})[key] ?? null;
    return {
      decided,
      undoDepth: this.undoStack.length,
      reverted: last.keys.length,
      focusKey: last.keys[0],
    };
  }

  #tag(items, personSlugs) {
    invariant(
      Array.isArray(personSlugs) && personSlugs.length > 0,
      "a name is needed before this can be saved",
    );
    const people = personSlugs.map((slug) => {
      const person = this.personBySlug.get(slug);
      invariant(person, `${slug} is not on the guest list`);
      return person;
    });
    const wave = findOrCreateWave(this.additions.source, this.model.buildFingerprint);
    const existing = new Set(
      this.additions.additions.map((addition) => `${addition.photoId}:${addition.personSlug}`),
    );
    for (const item of items) {
      for (const person of people) {
        const pair = `${item.photoId}:${person.slug}`;
        // Also drop any removal that would now contradict this addition.
        this.removals.removals = (this.removals.removals ?? []).filter(
          (removal) => `${removal.photoId}:${removal.personSlug}` !== pair,
        );
        if (existing.has(pair)) continue;
        existing.add(pair);
        this.additions.additions.push({
          photoId: item.photoId,
          path: item.catalogPath,
          personSlug: person.slug,
          displayName: person.name,
          faceIndex: item.faceIndex,
          confirmationKind: CONFIRMATION_KIND,
          reviewWave: wave.wave,
          reviewFingerprint: this.model.buildFingerprint,
          contextEvidence:
            `Rachel identified this face as ${person.name} while looking at ` +
            `${item.catalogPath} in the local naming session. No model score was used.`,
        });
      }
    }
    refreshCounts(
      this.additions,
      wave,
      this.model.buildFingerprint,
      new Date().toISOString().slice(0, 10),
    );
  }

  #remove(items, personSlugs, reason) {
    invariant(
      typeof reason === "string" && reason.trim().length >= 20,
      "a removal needs a written reason",
    );
    const seen = new Set(
      (this.removals.removals ?? []).map((removal) => `${removal.photoId}:${removal.personSlug}`),
    );
    for (const item of items) {
      for (const slug of personSlugs || []) {
        const person = this.personBySlug.get(slug);
        invariant(person, `${slug} is not on the guest list`);
        const pair = `${item.photoId}:${person.slug}`;
        // An addition and a removal for the same pair contradict each other.
        this.additions.additions = this.additions.additions.filter(
          (addition) => `${addition.photoId}:${addition.personSlug}` !== pair,
        );
        if (seen.has(pair)) continue;
        seen.add(pair);
        this.removals.removals = [
          ...(this.removals.removals ?? []),
          {
            photoId: item.photoId,
            path: item.catalogPath,
            personSlug: person.slug,
            displayName: person.name,
            reason: reason.trim(),
            evidence: {
              source: "local face-naming session",
              reviewFingerprint: this.model.buildFingerprint,
            },
          },
        ];
      }
    }
    this.removals.source = this.removals.source ?? {};
    this.removals.source.reviewedBy = "Zach and Rachel";
    this.removals.source.reviewedAt = new Date().toISOString().slice(0, 10);
    const wave = (this.additions.source.reviewWaves ?? []).find(
      (candidate) =>
        candidate.reviewType === REVIEW_TYPE &&
        candidate.auditFingerprint === this.model.buildFingerprint,
    );
    if (wave) {
      refreshCounts(
        this.additions,
        wave,
        this.model.buildFingerprint,
        new Date().toISOString().slice(0, 10),
      );
    }
  }

  #reopen(items) {
    for (const item of items) {
      this.additions.additions = this.additions.additions.filter(
        (addition) =>
          !(
            addition.photoId === item.photoId &&
            addition.confirmationKind === CONFIRMATION_KIND &&
            addition.reviewFingerprint === this.model.buildFingerprint
          ),
      );
      this.removals.removals = (this.removals.removals ?? []).filter(
        (removal) =>
          !(
            removal.photoId === item.photoId &&
            removal.evidence?.reviewFingerprint === this.model.buildFingerprint
          ),
      );
    }
    const wave = (this.additions.source.reviewWaves ?? []).find(
      (candidate) =>
        candidate.reviewType === REVIEW_TYPE &&
        candidate.auditFingerprint === this.model.buildFingerprint,
    );
    if (wave) {
      refreshCounts(
        this.additions,
        wave,
        this.model.buildFingerprint,
        new Date().toISOString().slice(0, 10),
      );
    }
  }

  /** Dry run of the real overlay pass against a throwaway copy of the catalog. */
  #validate() {
    const catalog = JSON.parse(JSON.stringify(this.catalog));
    try {
      applyCatalogOverlays(catalog, this.attendees, this.additions, this.removals);
    } catch (error) {
      throw new DecisionError(error.message);
    }
  }

  summary() {
    const mine = this.additions.additions.filter(
      (addition) =>
        addition.confirmationKind === CONFIRMATION_KIND &&
        addition.reviewFingerprint === this.model.buildFingerprint,
    );
    const entries = Object.values(this.ledger.entries || {});
    return {
      namesAdded: mine.length,
      facesNamed: entries.filter((entry) => entry.action === "tag").length,
      notAGuest: entries.filter((entry) => entry.action === "not-a-guest").length,
      notSure: entries.filter((entry) => entry.action === "skip").length,
      tooBlurry: entries.filter((entry) => entry.action === "too-blurry").length,
      namesRemoved: entries.filter((entry) => entry.action === "remove").length,
    };
  }
}
