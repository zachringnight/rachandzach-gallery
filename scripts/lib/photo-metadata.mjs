import { promises as fs } from "node:fs";

export const ignoredKeywords = new Set(["Wedding", "Rachel & Zach"]);

export const displayNameOverrides = new Map([
  ["Rach", "Rachel Casciano"],
  ["Rachel", "Rachel Casciano"],
  ["Zach", "Zach Soskin"]
]);

export function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeName(value) {
  const decoded = decodeXml(value);
  return displayNameOverrides.get(decoded) || decoded;
}

export function isUsefulName(value) {
  if (!value || ignoredKeywords.has(value)) return false;
  if (/^\d+([.,]\s*\d+)*$/.test(value)) return false;
  if (value.length > 60) return false;
  return true;
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values) {
  return `${values.map(csvEscape).join(",")}\n`;
}

export function parseCsv(text) {
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

  return rows.filter((csvRowValue) => csvRowValue.some((value) => value.trim()));
}

export function splitPeople(value) {
  return [...new Set(
    String(value || "")
      .split(";")
      .map((name) => normalizeName(name.trim()))
      .filter(isUsefulName)
  )].sort((a, b) => a.localeCompare(b));
}

function extractSection(xml, tag) {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "i");
  return xml.match(expression)?.[0] || "";
}

function extractListItems(xml) {
  return [...xml.matchAll(/<rdf:li(?:\s[^>]*)?>([^<]+)<\/rdf:li>/gi)].map((match) => decodeXml(match[1]));
}

export function extractMetadata(buffer) {
  const xml = buffer.toString("latin1");
  const rawNames = new Set();
  const rawKeywords = new Set();

  for (const match of xml.matchAll(/mwg-rs:Name="([^"]+)"/gi)) {
    rawNames.add(decodeXml(match[1]));
  }

  for (const tag of ["dc:subject", "lr:weightedFlatSubject", "lr:hierarchicalSubject"]) {
    const section = extractSection(xml, tag);
    for (const item of extractListItems(section)) {
      rawKeywords.add(item);
      if (!ignoredKeywords.has(item)) rawNames.add(item);
    }
  }

  const people = [...rawNames].map(normalizeName).filter(isUsefulName);
  const keywords = [...rawKeywords].map(normalizeName).filter(isUsefulName);

  return {
    people: [...new Set(people)].sort((a, b) => a.localeCompare(b)),
    keywords: [...new Set(keywords)].sort((a, b) => a.localeCompare(b))
  };
}

export function applyCorrection(people, correction) {
  if (!correction) return people;

  if (correction.action === "replace") {
    return correction.people;
  }

  if (correction.action === "add") {
    return [...new Set([...people, ...correction.people])].sort((a, b) => a.localeCompare(b));
  }

  if (correction.action === "remove") {
    const remove = new Set(correction.people);
    return people.filter((person) => !remove.has(person));
  }

  if (correction.action === "ignore") {
    return [];
  }

  return people;
}

export async function readCorrections(correctionsFile) {
  const text = await fs.readFile(correctionsFile, "utf8").catch(() => "");
  if (!text.trim()) return new Map();

  const [headers, ...rows] = parseCsv(text);
  const headerIndex = new Map(headers.map((header, index) => [header.trim(), index]));
  const corrections = new Map();

  for (const row of rows) {
    const path = row[headerIndex.get("path")]?.trim();
    const action = row[headerIndex.get("action")]?.trim().toLowerCase();
    if (!path || !action) continue;

    corrections.set(path, {
      action,
      people: splitPeople(row[headerIndex.get("people")]),
      notes: row[headerIndex.get("notes")] || "",
      reviewer: row[headerIndex.get("reviewer")] || "",
      updatedAt: row[headerIndex.get("updated_at")] || ""
    });
  }

  return corrections;
}
