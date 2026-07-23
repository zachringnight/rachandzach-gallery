"use client";

import { useState } from "react";
import { MAX_SELECTION_ITEMS } from "@/lib/downloads/contracts";

export interface AlbumShortlistSourcePhoto {
  id: string;
  eventName: string;
  people: string[];
}

export interface AlbumShortlistExportProps {
  /** Already in the guest's favorite/shortlist order; index+1 becomes the
   *  exported favoriteOrder column. */
  photos: AlbumShortlistSourcePhoto[];
  /** Base filename (no extension) for the downloaded file. */
  filenamePrefix?: string;
  className?: string;
}

interface ShortlistRow {
  id: string;
  filename: string;
  eventName: string;
  people: string[];
}

const CSV_HEADER = ["photo_id", "filename", "event", "people", "favorite_order"];

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Photo id, filename, event, people, and favorite order only -- deliberately
 * no signed URL or any other private field, per the packet's "Do not include
 * private signed URLs" rule.
 */
export function buildShortlistCsv(rows: ShortlistRow[]): string {
  const lines = rows.map((row, index) =>
    [row.id, row.filename, row.eventName, row.people.join("; "), String(index + 1)]
      .map(csvField)
      .join(","),
  );
  return [CSV_HEADER.join(","), ...lines].join("\r\n") + "\r\n";
}

export interface ShortlistJsonEntry {
  photoId: string;
  filename: string;
  event: string;
  people: string[];
  favoriteOrder: number;
}

export function buildShortlistJson(rows: ShortlistRow[]): ShortlistJsonEntry[] {
  return rows.map((row, index) => ({
    photoId: row.id,
    filename: row.filename,
    event: row.eventName,
    people: row.people,
    favoriteOrder: index + 1,
  }));
}

function triggerDownload(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Approved original filenames are not part of ClientPhoto (the gallery's
 * browsing payload deliberately strips them; see
 * src/lib/gallery/client-types.ts). The shortlist genuinely needs the real
 * filename so an album vendor can match rows back to files, so this looks it
 * up via the existing POST /api/downloads/selection endpoint (chunked at
 * MAX_SELECTION_ITEMS) and keeps ONLY each item's filename -- every signed
 * URL that call returns is discarded immediately, never exported or stored.
 * Falls back to "<photoId>.jpg" for any id the lookup could not resolve, so
 * export always succeeds even if a photo was unapproved between favoriting
 * and exporting.
 */
async function resolveFilenames(ids: string[]): Promise<Map<string, string>> {
  const filenames = new Map<string, string>();
  for (const group of chunk(ids, MAX_SELECTION_ITEMS)) {
    if (group.length === 0) continue;
    try {
      const response = await fetch("/api/downloads/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: group }),
      });
      if (!response.ok) continue;
      const body = (await response.json()) as {
        items: { photoId: string; filename: string }[];
      };
      for (const item of body.items) filenames.set(item.photoId, item.filename);
    } catch {
      // Best-effort: unresolved ids fall back to a placeholder filename below.
    }
  }
  return filenames;
}

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-ink/20 bg-transparent px-3 py-1.5 text-sm text-ink transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Exports the guest's shortlist (favorites, in order) as CSV or JSON for
 * planning a future printed album -- never includes a signed URL (those
 * expire and are private to the guest's session).
 */
export function AlbumShortlistExport({
  photos,
  filenamePrefix = "album-shortlist",
  className,
}: AlbumShortlistExportProps) {
  const [busy, setBusy] = useState(false);
  const disabled = busy || photos.length === 0;

  const handleExport = async (kind: "csv" | "json") => {
    setBusy(true);
    try {
      const filenames = await resolveFilenames(photos.map((photo) => photo.id));
      const rows: ShortlistRow[] = photos.map((photo) => ({
        id: photo.id,
        filename: filenames.get(photo.id) ?? `${photo.id}.jpg`,
        eventName: photo.eventName,
        people: photo.people,
      }));
      if (kind === "csv") {
        triggerDownload(`${filenamePrefix}.csv`, buildShortlistCsv(rows), "text/csv");
      } else {
        triggerDownload(
          `${filenamePrefix}.json`,
          JSON.stringify(buildShortlistJson(rows), null, 2),
          "application/json",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={disabled}
        onClick={() => void handleExport("csv")}
      >
        Export CSV
      </button>
      <button
        type="button"
        className={BUTTON_CLASS}
        disabled={disabled}
        onClick={() => void handleExport("json")}
      >
        Export JSON
      </button>
    </div>
  );
}
