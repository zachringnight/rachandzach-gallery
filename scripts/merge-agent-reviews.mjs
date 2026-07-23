import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url)).replace(/\/scripts$/, "");
const reviewsDir = join(rootDir, "metadata", "agent-reviews");
const activeCorrectionsFile = join(rootDir, "metadata", "people-corrections.csv");
const proposedCorrectionsFile = join(rootDir, "metadata", "people-corrections.proposed.csv");
const apply = process.env.APPLY_AGENT_REVIEWS === "1";

const allowedActions = new Set(["ignore", "exclude", "replace"]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((csvRow) => csvRow.some((value) => value.trim()));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return `${values.map(csvEscape).join(",")}\n`;
}

async function readCorrections(path) {
  const text = await fs.readFile(path, "utf8").catch(() => "path,action,people,notes,reviewer,updated_at\n");
  const [headers, ...rows] = parseCsv(text);
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));
  const corrections = new Map();

  for (const row of rows) {
    const photoPath = row[headerIndex.get("path")]?.trim();
    if (!photoPath) continue;
    corrections.set(photoPath, {
      path: photoPath,
      action: row[headerIndex.get("action")] || "",
      people: row[headerIndex.get("people")] || "",
      notes: row[headerIndex.get("notes")] || "",
      reviewer: row[headerIndex.get("reviewer")] || "",
      updated_at: row[headerIndex.get("updated_at")] || ""
    });
  }

  return corrections;
}

async function readAgentReviews() {
  const files = (await fs.readdir(reviewsDir).catch(() => []))
    .filter((file) => /^sheets-\d{2}-\d{2}\.csv$/.test(file))
    .sort();
  const rows = [];

  for (const file of files) {
    const text = await fs.readFile(join(reviewsDir, file), "utf8");
    const [headers, ...csvRows] = parseCsv(text);
    const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));

    for (const row of csvRows) {
      const recommendation = row[headerIndex.get("recommendation")]?.trim().toLowerCase();
      const path = row[headerIndex.get("path")]?.trim();
      if (!path || !allowedActions.has(recommendation)) continue;

      rows.push({
        path,
        action: recommendation,
        people: row[headerIndex.get("people")] || "",
        notes: row[headerIndex.get("notes")] || "",
        reviewer: file.replace(/\.csv$/, ""),
        updated_at: new Date().toISOString()
      });
    }
  }

  return rows;
}

async function main() {
  const corrections = await readCorrections(activeCorrectionsFile);
  const agentRows = await readAgentReviews();

  for (const row of agentRows) {
    if (corrections.has(row.path)) continue;
    corrections.set(row.path, row);
  }

  const outputRows = [csvRow(["path", "action", "people", "notes", "reviewer", "updated_at"])];
  for (const row of [...corrections.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    outputRows.push(csvRow([row.path, row.action, row.people, row.notes, row.reviewer, row.updated_at]));
  }

  const outputPath = apply ? activeCorrectionsFile : proposedCorrectionsFile;
  await fs.writeFile(outputPath, outputRows.join(""));

  console.log(`Read ${agentRows.length} safe agent recommendations.`);
  console.log(`Wrote ${outputPath.replace(`${rootDir}/`, "")}`);
  if (!apply) {
    console.log("Set APPLY_AGENT_REVIEWS=1 to update metadata/people-corrections.csv.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
