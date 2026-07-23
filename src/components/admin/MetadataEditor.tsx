"use client";

/**
 * Metadata editor (packet 10): event assignment, confirmed-person tags,
 * keywords, and note approval. Applied to whichever items are currently
 * selected in BatchReviewer before an approve action -- upload_items has no
 * columns to hold this metadata in the meantime, so it lives as local
 * component state until the moment of approval, when it travels with the
 * decision to POST /api/admin/batches/[batchId]/approve.
 */
import { useState } from "react";

export interface MetadataOption {
  slug: string;
  name: string;
}

export interface MetadataValue {
  eventSlug: string | null;
  peopleSlugs: string[];
  keywords: string[];
  noteApproved: boolean;
}

interface MetadataEditorProps {
  events: MetadataOption[];
  people: MetadataOption[];
  guestNote: string | null;
  value: MetadataValue;
  onChange: (value: MetadataValue) => void;
  disabled?: boolean;
}

const labelStyle = {
  color: "var(--color-muted)",
  fontSize: "0.75rem",
  textTransform: "uppercase" as const,
  letterSpacing: "0.04em",
};

export function MetadataEditor({
  events,
  people,
  guestNote,
  value,
  onChange,
  disabled,
}: MetadataEditorProps) {
  const [keywordDraft, setKeywordDraft] = useState(value.keywords.join(", "));

  function togglePerson(slug: string) {
    const next = value.peopleSlugs.includes(slug)
      ? value.peopleSlugs.filter((s) => s !== slug)
      : [...value.peopleSlugs, slug];
    onChange({ ...value, peopleSlugs: next });
  }

  function commitKeywords(raw: string) {
    const keywords = raw
      .split(",")
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 0 && kw.length <= 80);
    onChange({ ...value, keywords });
  }

  return (
    <div
      className="flex flex-col gap-4 border px-5 py-4"
      style={{
        borderColor: "var(--color-sand)",
        borderRadius: "var(--radius-card)",
        backgroundColor: "var(--color-cream)",
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="event-select" style={labelStyle}>
          Event
        </label>
        <select
          id="event-select"
          value={value.eventSlug ?? ""}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, eventSlug: e.target.value || null })
          }
          className="border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-sand)", borderRadius: "var(--radius-card)" }}
        >
          <option value="">No event assigned</option>
          {events.map((event) => (
            <option key={event.slug} value={event.slug}>
              {event.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span style={labelStyle}>Confirmed people</span>
        <div className="flex flex-wrap gap-2">
          {people.length === 0 && (
            <span className="text-sm" style={{ color: "var(--color-muted)" }}>
              No people in the catalog yet.
            </span>
          )}
          {people.map((person) => {
            const active = value.peopleSlugs.includes(person.slug);
            return (
              <button
                key={person.slug}
                type="button"
                disabled={disabled}
                onClick={() => togglePerson(person.slug)}
                className="px-3 py-1 text-sm"
                style={{
                  borderRadius: "var(--radius-card)",
                  border: `1px solid ${active ? "var(--color-coral)" : "var(--color-sand)"}`,
                  backgroundColor: active ? "var(--color-coral)" : "var(--color-white)",
                  color: active ? "var(--color-white)" : "var(--color-ink)",
                }}
              >
                {person.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="keyword-input" style={labelStyle}>
          Keywords (comma separated)
        </label>
        <input
          id="keyword-input"
          type="text"
          value={keywordDraft}
          disabled={disabled}
          onChange={(e) => setKeywordDraft(e.target.value)}
          onBlur={() => commitKeywords(keywordDraft)}
          placeholder="first dance, sparklers, cake cutting"
          className="border px-3 py-2 text-sm"
          style={{ borderColor: "var(--color-sand)", borderRadius: "var(--radius-card)" }}
        />
      </div>

      {guestNote && (
        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-sand)" }}>
          <span style={labelStyle}>Guest&apos;s note</span>
          <p className="text-sm italic" style={{ color: "var(--color-ink)" }}>
            &ldquo;{guestNote}&rdquo;
          </p>
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--color-ink)" }}>
            <input
              type="checkbox"
              checked={value.noteApproved}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, noteApproved: e.target.checked })}
            />
            Show this note publicly alongside the photos
          </label>
        </div>
      )}
    </div>
  );
}
