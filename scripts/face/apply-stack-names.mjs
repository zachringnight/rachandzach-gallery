#!/usr/bin/env node
/**
 * Apply names given against the numbered stack sheets.
 *
 * Input is one "<number> <name>" per line, the shape a person types when
 * reading a contact sheet:
 *
 *   3 Linda Willey
 *   7 Danny Listrani
 *   12 skip
 *
 * A name is matched against the catalog roster, case and punctuation
 * insensitive, and must resolve to exactly one person or the run aborts
 * before writing anything. "skip", "?" and "-" record no decision at all, so
 * the stack simply stays in the queue.
 *
 * Every face in the stack is tagged, EXCEPT faces already answered in the
 * naming ledger: a confirmed name is the more considered answer and is
 * already written into the additions overlay, which this would not unwind.
 *
 * Dry run by default. --write validates the whole batch against a throwaway
 * catalog copy first, exactly as the browser tagger does, then writes the
 * reviewed additions and the decision ledger atomically.
 *
 *   node scripts/face/apply-stack-names.mjs answers.txt
 *   node scripts/face/apply-stack-names.mjs answers.txt --write
 */
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NamingSession } from "../lib/naming-decisions.mjs";
import { buildNamingModel } from "../lib/naming-tool.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX = join(repoRoot, "metadata/faces/stack-sheets/index.json");

const SKIP_WORDS = new Set(["skip", "?", "-", "none", "unknown", "no"]);

/** Roster keys ignore case, punctuation and doubled spaces. */
function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAnswers(text) {
  const answers = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\d+)\s*(?:[.):=-]|is\b)?\s*(.*)$/i);
    if (!match) throw new Error(`cannot read this line: ${line}`);
    const value = match[2].trim().replace(/^is\s+/i, "");
    answers.push({ number: Number(match[1]), value });
  }
  return answers;
}

async function main() {
  const write = process.argv.includes("--write");
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) throw new Error("pass a file of answers, one per line");

  const [index, model, answersText] = await Promise.all([
    fs.readFile(INDEX, "utf8").then(JSON.parse),
    buildNamingModel({ repoRoot }),
    fs.readFile(resolve(file), "utf8"),
  ]);

  if (index.builtFrom !== model.buildFingerprint) {
    throw new Error(
      "the sheets were rendered against a different queue than the one on " +
        "disk now. Re-render with render-stack-sheets.mjs before applying, " +
        "so a number still means the stack it meant on the sheet.",
    );
  }

  const byNumber = new Map(index.stacks.map((stack) => [stack.number, stack]));
  const rosterByName = new Map();
  for (const person of model.roster) {
    const key = normalize(person.name);
    if (!rosterByName.has(key)) rosterByName.set(key, []);
    rosterByName.get(key).push(person);
  }

  const session = await NamingSession.open({ repoRoot, model });

  // Only a settled answer blocks a name. "Not sure" is explicitly the
  // re-askable one: it means nobody could place the face at the time, and
  // putting a name to it later is the whole point of asking again. Tags,
  // "not a guest" and "too blurry" are settled and are left alone, a tag
  // most of all, since it is already written into the additions overlay.
  const SETTLED = new Set(["tag", "not-a-guest", "too-blurry", "remove"]);
  const decidedKeys = new Set(
    Object.entries(session.ledger?.entries ?? {})
      .filter(([, entry]) => SETTLED.has(entry.action))
      .map(([key]) => key),
  );
  const plan = [];
  const problems = [];
  const notices = [];

  for (const answer of parseAnswers(answersText)) {
    const stack = byNumber.get(answer.number);
    if (!stack) {
      problems.push(`no stack numbered ${answer.number}`);
      continue;
    }
    if (!answer.value || SKIP_WORDS.has(answer.value.toLowerCase())) continue;

    // Verdicts that are not a name. Same vocabulary as the browser tagger,
    // so a sheet answer and a keystroke answer record identically.
    const verdict = { "!blurry": "too-blurry", "!notguest": "not-a-guest" }[
      answer.value.toLowerCase()
    ];
    if (verdict) {
      const keys = stack.keys.filter((key) => !decidedKeys.has(key));
      if (keys.length) {
        plan.push({ number: answer.number, action: verdict, keys, stack });
      }
      continue;
    }

    const matches = rosterByName.get(normalize(answer.value)) ?? [];
    if (matches.length === 0) {
      problems.push(`"${answer.value}" (stack ${answer.number}) is not on the guest list`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(
        `"${answer.value}" (stack ${answer.number}) matches ${matches.length} people`,
      );
      continue;
    }
    const keys = stack.keys.filter((key) => !decidedKeys.has(key));
    if (keys.length === 0) {
      // Already settled. Agreeing with what is there is a no-op worth
      // noting, not an error. Disagreeing is worth stopping for: it means
      // the sheet and an earlier session named the same face differently,
      // and only a person can say which is right.
      const existing = new Set();
      for (const key of stack.keys) {
        for (const slug of session.ledger?.entries?.[key]?.personSlugs ?? []) {
          existing.add(slug);
        }
      }
      if (existing.size && !existing.has(matches[0].slug)) {
        problems.push(
          `stack ${answer.number} is already named ` +
            `${[...existing].join(", ")}, but the sheet says ${matches[0].slug}`,
        );
      } else {
        notices.push(`stack ${answer.number} was already ${matches[0].name}, nothing to do`);
      }
      continue;
    }
    plan.push({ number: answer.number, action: "tag", person: matches[0], keys, stack });
  }

  if (problems.length) {
    console.error("Nothing was written. Fix these first:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  if (notices.length) {
    for (const notice of notices) console.log(`  note: ${notice}`);
    console.log("");
  }

  const faces = plan.reduce((total, entry) => total + entry.keys.length, 0);
  const photos = new Set();
  for (const entry of plan) for (const key of entry.keys) photos.add(key);

  console.log(write ? "WRITING" : "DRY RUN, nothing will be written");
  console.log("");
  for (const entry of plan) {
    const label = entry.action === "tag"
      ? entry.person.name
      : entry.action === "too-blurry" ? "(too blurry)" : "(not a guest)";
    console.log(
      `  ${String(entry.number).padStart(3)}  ${label.padEnd(24)} ` +
        `${entry.keys.length} faces` +
        (entry.keys.length < entry.stack.keys.length
          ? ` (${entry.stack.keys.length - entry.keys.length} already answered, left alone)`
          : ""),
    );
  }
  console.log("");
  console.log(`${plan.length} stacks, ${faces} faces`);

  if (!write) {
    console.log("\nRe-run with --write to apply.");
    return;
  }

  for (const entry of plan) {
    await session.apply({
      keys: entry.keys,
      action: entry.action,
      personSlugs: entry.action === "tag" ? [entry.person.slug] : [],
      note: `From stack sheet ${entry.number}`,
    });
  }
  console.log("\nWritten. Next:");
  console.log("  node scripts/apply-catalog-overlays.mjs --write");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
