"use client";

/**
 * Review queue (packet 10): a batch list sorted by submitted time with
 * counts, duplicate flags, validation state, and contact information. Each
 * row links into BatchReviewer for the focused per-photo decision.
 */
import { useState } from "react";
import Link from "next/link";

export interface QueueCounts {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
}

export interface QueueEntry {
  batchId: string;
  displayName: string | null;
  hasEmail: boolean;
  note: string | null;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  counts: QueueCounts;
  hasDuplicates: boolean;
}

interface ReviewQueueProps {
  initialQueue: QueueEntry[];
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "Needs review",
  under_review: "In review",
  approved: "Approved",
  partially_approved: "Partially approved",
  rejected: "Rejected",
};

function statusColor(status: string): string {
  if (status === "submitted" || status === "under_review") return "var(--color-coral)";
  if (status === "rejected") return "var(--color-muted)";
  return "var(--color-tan)";
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function ReviewQueue({ initialQueue }: ReviewQueueProps) {
  const [queue, setQueue] = useState(initialQueue);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/batches", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Could not refresh the queue (${response.status}).`);
      }
      const body = (await response.json()) as { queue: QueueEntry[] };
      setQueue(body.queue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the queue.");
    } finally {
      setRefreshing(false);
    }
  }

  const needsReview = queue.filter(
    (entry) => entry.status === "submitted" || entry.status === "under_review",
  );
  const decided = queue.filter(
    (entry) => entry.status !== "submitted" && entry.status !== "under_review",
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
        >
          Review queue
        </h1>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="px-3 py-1.5 text-sm font-medium"
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--color-sand)",
            color: "var(--color-ink)",
          }}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--color-coral)" }}>
          {error}
        </p>
      )}

      {needsReview.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Nothing waiting on you right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {needsReview.map((entry) => (
            <QueueRow key={entry.batchId} entry={entry} />
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm" style={{ color: "var(--color-muted)" }}>
            Already decided ({decided.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {decided.map((entry) => (
              <QueueRow key={entry.batchId} entry={entry} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function QueueRow({ entry }: { entry: QueueEntry }) {
  return (
    <li>
      <Link
        href={`/admin/review/${entry.batchId}`}
        className="flex flex-wrap items-center justify-between gap-3 border px-5 py-4 transition-colors"
        style={{
          borderColor: "var(--color-sand)",
          borderRadius: "var(--radius-card)",
          backgroundColor: "var(--color-white)",
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="font-medium" style={{ color: "var(--color-ink)" }}>
            {entry.displayName?.trim() || "Anonymous guest"}
            {entry.hasEmail ? "" : " (no email on file)"}
          </span>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>
            Submitted {formatDate(entry.submittedAt)} &middot; {entry.counts.total} photo
            {entry.counts.total === 1 ? "" : "s"}
            {entry.hasDuplicates ? " · possible duplicates" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span style={{ color: "var(--color-muted)" }}>
            {entry.counts.pending} pending &middot; {entry.counts.approved} approved &middot;{" "}
            {entry.counts.rejected} rejected
          </span>
          <span
            className="px-2 py-1 font-semibold uppercase tracking-wide"
            style={{
              borderRadius: "var(--radius-card)",
              backgroundColor: "var(--color-cream)",
              color: statusColor(entry.status),
            }}
          >
            {STATUS_LABEL[entry.status] ?? entry.status}
          </span>
        </div>
      </Link>
    </li>
  );
}
