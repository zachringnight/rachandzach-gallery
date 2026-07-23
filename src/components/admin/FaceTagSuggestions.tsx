"use client";

/**
 * Face-tag suggestions for the batch reviewer (Round Two, face-recognition
 * moderation assist -- docs/0719_Round_Two_Features_v1.md). Renders the
 * proposed person tags the local InsightFace pipeline produced for this
 * batch's pending uploads: a checkbox per proposed person with the match
 * strength, scoped to the current selection when one exists.
 *
 * The checkboxes ARE the existing confirmed-tag decision flow: checking one
 * toggles that slug in MetadataEditor's peopleSlugs, so approval carries it
 * exactly like a hand-picked tag. Confident matches arrive pre-checked
 * (seeded by BatchReviewer's initial state); nothing here ever applies a tag
 * on its own, and when the pipeline produced nothing this renders nothing.
 *
 * Admin-only surface. Only slugs, names, and similarity scores reach the
 * browser; embeddings stay on the server (src/lib/moderation/
 * face-suggestions.ts keeps them local).
 */

export interface FaceTagSuggestion {
  /** Person slug from the catalog (rachandzach_people). */
  slug: string;
  /** Display name, catalog-corrected server-side. */
  name: string;
  /** Best cosine similarity against the person's face signature, 0..1. */
  similarity: number;
  /** True at the calibrated confident tier; pre-checked in the reviewer. */
  confident: boolean;
}

export interface ItemFaceSuggestions {
  itemId: string;
  suggestions: FaceTagSuggestion[];
}

export interface FaceTagSuggestionsProps {
  itemSuggestions: ItemFaceSuggestions[];
  /** Currently selected item ids; empty means "show the whole batch". */
  selectedItemIds: string[];
  /** The confirmed-people slugs currently staged in MetadataEditor. */
  confirmedSlugs: string[];
  onToggle: (slug: string) => void;
  disabled?: boolean;
}

/**
 * Union the suggestions across the items in scope, keeping the strongest
 * match per person, strongest first.
 */
export function aggregateSuggestions(
  itemSuggestions: ItemFaceSuggestions[],
  selectedItemIds: string[],
): FaceTagSuggestion[] {
  const scope =
    selectedItemIds.length > 0
      ? itemSuggestions.filter((item) => selectedItemIds.includes(item.itemId))
      : itemSuggestions;
  const best = new Map<string, FaceTagSuggestion>();
  for (const item of scope) {
    for (const suggestion of item.suggestions) {
      const current = best.get(suggestion.slug);
      if (!current || suggestion.similarity > current.similarity) {
        best.set(suggestion.slug, suggestion);
      }
    }
  }
  return [...best.values()].sort(
    (a, b) => b.similarity - a.similarity || a.slug.localeCompare(b.slug),
  );
}

export function FaceTagSuggestions({
  itemSuggestions,
  selectedItemIds,
  confirmedSlugs,
  onToggle,
  disabled,
}: FaceTagSuggestionsProps) {
  const rows = aggregateSuggestions(itemSuggestions, selectedItemIds);
  if (rows.length === 0) return null;

  const scoped = selectedItemIds.length > 0;
  return (
    <div
      className="flex flex-col gap-3 border px-5 py-4"
      style={{
        borderColor: "var(--color-sand)",
        borderRadius: "var(--radius-card)",
        backgroundColor: "var(--color-cream)",
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          Face suggestions
        </h2>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {scoped
            ? "Proposed from the selected photos by the local face pipeline."
            : "Proposed from this batch's pending photos by the local face pipeline."}{" "}
          Checked names join the confirmed people below; nothing applies until
          you approve.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const checked = confirmedSlugs.includes(row.slug);
          return (
            <li key={row.slug}>
              <label
                className="flex cursor-pointer items-center gap-2 text-sm"
                style={{ color: "var(--color-ink)" }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(row.slug)}
                />
                <span>{row.name}</span>
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {Math.round(row.similarity * 100)}% match
                  {row.confident ? ", strong" : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
