"use client";

/**
 * Memories review queue (Round Two): pending guest photo notes with
 * approve / reject, one decision per row. Page-ready: /admin/memories
 * server-fetches the initial list and hands it here for the refresh and
 * decision affordances. Styling follows the admin shell's token variables
 * (see ReviewQueue.tsx), not the guest surfaces.
 */
import { useState } from "react";
import Link from "next/link";
import type { AdminMemory } from "@/lib/memories/shared";

interface MemoriesReviewQueueProps {
  initialPending: AdminMemory[];
}

function formatDate(iso: string | null): string {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function MemoriesReviewQueue({ initialPending }: MemoriesReviewQueueProps) {
  const [pending, setPending] = useState(initialPending);
  const [refreshing, setRefreshing] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/memories", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Could not refresh the queue (${response.status}).`);
      }
      const body = (await response.json()) as { memories: AdminMemory[] };
      setPending(body.memories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the queue.");
    } finally {
      setRefreshing(false);
    }
  }

  async function decide(memoryId: string, decision: "approve" | "reject") {
    setDecidingId(memoryId);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/memories/${encodeURIComponent(memoryId)}/${decision}`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(`Could not ${decision} the memory (${response.status}).`);
      }
      setPending((rows) => rows.filter((row) => row.id !== memoryId));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Could not ${decision} the memory.`,
      );
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1
          className="text-2xl font-semibold"
          style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
        >
          Memories review
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

      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Guest notes attached to specific photos. Approving one puts it on that
        photo for every guest; rejecting keeps it here, hidden from everyone.
      </p>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--color-coral)" }}>
          {error}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Nothing waiting on you right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pending.map((memory) => (
            <li
              key={memory.id}
              className="flex flex-col gap-3 border px-5 py-4"
              style={{
                borderColor: "var(--color-sand)",
                borderRadius: "var(--radius-card)",
                backgroundColor: "var(--color-white)",
              }}
            >
              <blockquote
                className="text-sm"
                style={{ color: "var(--color-ink)" }}
              >
                {memory.body}
              </blockquote>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {memory.displayName?.trim() || "Anonymous guest"} &middot;{" "}
                  {formatDate(memory.createdAt)} &middot;{" "}
                  <Link
                    href={`/photos/${memory.photoId}`}
                    className="underline"
                    style={{ color: "var(--color-ink)" }}
                  >
                    View photo
                  </Link>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(memory.id, "approve")}
                    disabled={decidingId === memory.id}
                    className="px-3 py-1.5 text-sm font-medium"
                    style={{
                      borderRadius: "var(--radius-card)",
                      border: "1px solid var(--color-sand)",
                      color: "var(--color-ink)",
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(memory.id, "reject")}
                    disabled={decidingId === memory.id}
                    className="px-3 py-1.5 text-sm font-medium"
                    style={{
                      borderRadius: "var(--radius-card)",
                      border: "1px solid var(--color-sand)",
                      color: "var(--color-coral)",
                    }}
                  >
                    Reject
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
