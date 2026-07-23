"use client";

/**
 * Batch reviewer (packet 10): a focused per-batch view with large previews,
 * accept, reject, select all, event assignment, confirmed-person tags,
 * keywords, and note approval -- plus the batch's notification_log history
 * (kind, status, created_at, provider id) so the admin can see what was
 * actually sent.
 *
 * Approve/reject act on whatever is selected, so "select all" + Approve is
 * the batch-approve gesture and a single checkbox + Approve is the per-photo
 * gesture; there is no separate code path for the two.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MetadataEditor, type MetadataOption, type MetadataValue } from "./MetadataEditor";
import { FaceTagSuggestions, type ItemFaceSuggestions } from "./FaceTagSuggestions";

export interface ReviewItem {
  itemId: string;
  originalName: string;
  mediaType: string;
  bytes: number;
  status: string;
  rejectionReason: string | null;
  previewUrl: string | null;
  createdAt: string;
}

export interface NotificationLogEntry {
  kind: string;
  status: string;
  createdAt: string;
  providerId: string | null;
}

export interface BatchReviewerProps {
  batchId: string;
  displayName: string | null;
  email: string | null;
  note: string | null;
  batchStatus: string;
  items: ReviewItem[];
  events: MetadataOption[];
  people: MetadataOption[];
  notifications: NotificationLogEntry[];
  /**
   * Per-item face-pipeline tag proposals (Round Two moderation assist).
   * Absent whenever the local pipeline is unavailable; the suggestion
   * surface then renders nothing at all.
   */
  faceSuggestions?: ItemFaceSuggestions[];
}

/**
 * Confident pipeline matches arrive pre-checked: they seed the confirmed
 * people list as INITIAL state, so they read as ordinary staged tags the
 * admin can untoggle anywhere (here or in MetadataEditor's chips) before
 * approving. Sorted for a stable render order.
 */
function confidentSuggestionSlugs(
  faceSuggestions: ItemFaceSuggestions[] | undefined,
): string[] {
  const slugs = new Set<string>();
  for (const item of faceSuggestions ?? []) {
    for (const suggestion of item.suggestions) {
      if (suggestion.confident) slugs.add(suggestion.slug);
    }
  }
  return [...slugs].sort();
}

interface ItemResult {
  itemId: string;
  ok: boolean;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const NOTIFICATION_KIND_LABEL: Record<string, string> = {
  admin_new_batch: "Admin notified",
  guest_receipt: "Guest receipt",
  guest_approved: "Guest approved receipt",
  guest_rejected: "Guest decline receipt",
};

export function BatchReviewer({
  batchId,
  displayName,
  email,
  note,
  batchStatus,
  items,
  events,
  people,
  notifications,
  faceSuggestions,
}: BatchReviewerProps) {
  const router = useRouter();
  const pendingItems = useMemo(() => items.filter((item) => item.status === "pending"), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [metadata, setMetadata] = useState<MetadataValue>(() => ({
    eventSlug: null,
    peopleSlugs: confidentSuggestionSlugs(faceSuggestions),
    keywords: [],
    noteApproved: false,
  }));
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ItemResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function selectAllPending() {
    setSelected(new Set(pendingItems.map((item) => item.itemId)));
  }

  function toggleSuggestedPerson(slug: string) {
    setMetadata((prev) => ({
      ...prev,
      peopleSlugs: prev.peopleSlugs.includes(slug)
        ? prev.peopleSlugs.filter((s) => s !== slug)
        : [...prev.peopleSlugs, slug],
    }));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function submit(action: "approve" | "reject") {
    if (selected.size === 0) {
      setErrorMessage("Select at least one photo first.");
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    setResults(null);
    try {
      const body =
        action === "approve"
          ? {
              itemIds: Array.from(selected),
              eventSlug: metadata.eventSlug,
              peopleSlugs: metadata.peopleSlugs,
              keywords: metadata.keywords,
              noteApproved: metadata.noteApproved,
            }
          : {
              itemIds: Array.from(selected),
              rejectionReason: rejectReason.trim() || null,
            };
      const response = await fetch(`/api/admin/batches/${batchId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { results?: ItemResult[]; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Request failed (${response.status}).`);
      }
      setResults(payload.results ?? null);
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-semibold"
            style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
          >
            {displayName?.trim() || "Anonymous guest"}
          </h1>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            {email ?? "No email on file"} &middot; batch status: {batchStatus}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAllPending}
            disabled={pendingItems.length === 0}
            className="px-3 py-1.5 text-sm"
            style={{ borderRadius: "var(--radius-card)", border: "1px solid var(--color-sand)" }}
          >
            Select all pending ({pendingItems.length})
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={selected.size === 0}
            className="px-3 py-1.5 text-sm"
            style={{ borderRadius: "var(--radius-card)", border: "1px solid var(--color-sand)" }}
          >
            Clear selection
          </button>
        </div>
      </div>

      {errorMessage && (
        <p className="text-sm" style={{ color: "var(--color-coral)" }}>
          {errorMessage}
        </p>
      )}

      {results && (
        <div
          className="flex flex-col gap-1 border px-4 py-3 text-sm"
          style={{ borderColor: "var(--color-sand)", borderRadius: "var(--radius-card)" }}
        >
          {results.map((result) => (
            <span
              key={result.itemId}
              style={{ color: result.ok ? "var(--color-tan)" : "var(--color-coral)" }}
            >
              {result.itemId.slice(0, 8)}: {result.ok ? "done" : result.error}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {items.map((item) => (
              <ItemCard
                key={item.itemId}
                item={item}
                checked={selected.has(item.itemId)}
                onToggle={() => toggle(item.itemId)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="reject-reason"
                className="text-xs uppercase tracking-wide"
                style={{ color: "var(--color-muted)" }}
              >
                Rejection reason (internal only -- never shown to the guest)
              </label>
              <input
                id="reject-reason"
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="mt-1 w-full border px-3 py-2 text-sm"
                style={{ borderColor: "var(--color-sand)", borderRadius: "var(--radius-card)" }}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submit("approve")}
                disabled={busy || selected.size === 0}
                className="px-4 py-2 text-sm font-semibold uppercase tracking-wide"
                style={{
                  borderRadius: "var(--radius-card)",
                  backgroundColor: "var(--color-ink)",
                  color: "var(--color-cream)",
                }}
              >
                {busy ? "Working..." : `Approve (${selected.size})`}
              </button>
              <button
                type="button"
                onClick={() => void submit("reject")}
                disabled={busy || selected.size === 0}
                className="px-4 py-2 text-sm font-semibold uppercase tracking-wide"
                style={{
                  borderRadius: "var(--radius-card)",
                  border: "1px solid var(--color-coral)",
                  color: "var(--color-coral)",
                }}
              >
                Reject ({selected.size})
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <FaceTagSuggestions
            itemSuggestions={faceSuggestions ?? []}
            selectedItemIds={Array.from(selected)}
            confirmedSlugs={metadata.peopleSlugs}
            onToggle={toggleSuggestedPerson}
            disabled={busy}
          />
          <MetadataEditor
            events={events}
            people={people}
            guestNote={note}
            value={metadata}
            onChange={setMetadata}
            disabled={busy}
          />

          <div
            className="flex flex-col gap-2 border px-4 py-4"
            style={{ borderColor: "var(--color-sand)", borderRadius: "var(--radius-card)" }}
          >
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Notification history
            </h2>
            {notifications.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                Nothing sent yet for this batch.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {notifications.map((entry, index) => (
                  <li key={index} className="flex flex-col" style={{ color: "var(--color-muted)" }}>
                    <span style={{ color: "var(--color-ink)" }}>
                      {NOTIFICATION_KIND_LABEL[entry.kind] ?? entry.kind} &middot; {entry.status}
                    </span>
                    <span>
                      {formatDate(entry.createdAt)}
                      {entry.providerId ? ` · ${entry.providerId}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  checked,
  onToggle,
}: {
  item: ReviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const isHeic = item.mediaType === "image/heic";
  return (
    <label
      className="flex cursor-pointer flex-col gap-2 border p-2 text-xs"
      style={{
        borderColor: checked ? "var(--color-coral)" : "var(--color-sand)",
        borderRadius: "var(--radius-card)",
        backgroundColor: "var(--color-white)",
      }}
    >
      <div className="flex items-center justify-between">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={item.status !== "pending"}
        />
        <span style={{ color: "var(--color-muted)" }}>{item.status}</span>
      </div>
      <div
        className="flex aspect-square items-center justify-center overflow-hidden"
        style={{ backgroundColor: "var(--color-cream)", borderRadius: "var(--radius-card)" }}
      >
        {isHeic || !item.previewUrl ? (
          <span className="px-2 text-center" style={{ color: "var(--color-muted)" }}>
            {isHeic
              ? "HEIC -- preview renders after approval"
              : "Preview unavailable"}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private-storage URL, not a Next.js Image domain.
          <img
            src={item.previewUrl}
            alt={item.originalName}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex flex-col" style={{ color: "var(--color-ink)" }}>
        <span className="truncate">{item.originalName}</span>
        <span style={{ color: "var(--color-muted)" }}>{formatBytes(item.bytes)}</span>
        {item.rejectionReason && (
          <span style={{ color: "var(--color-coral)" }}>{item.rejectionReason}</span>
        )}
      </div>
    </label>
  );
}
