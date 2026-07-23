"use client";

/**
 * The upload queue (packet 08): one row per selected file with live progress
 * and pause / resume / retry / remove controls. Duplicate selections are
 * flagged inline rather than blocked.
 */
import type { QueueItem } from "./types";

interface UploadQueueProps {
  items: QueueItem[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABEL: Record<QueueItem["status"], string> = {
  queued: "Waiting",
  signing: "Preparing",
  uploading: "Uploading",
  paused: "Paused",
  error: "Failed",
  done: "Uploaded",
};

export function UploadQueue({
  items,
  onPause,
  onResume,
  onRetry,
  onRemove,
}: UploadQueueProps) {
  if (items.length === 0) return null;

  return (
    <ul
      className="flex flex-col gap-2"
      style={{ fontFamily: "var(--font-body)" }}
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-2 border px-4 py-3"
          style={{
            borderColor: "var(--color-sand)",
            borderRadius: "var(--radius-card)",
            backgroundColor: "var(--color-white)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span
              className="truncate text-sm font-medium"
              style={{ color: "var(--color-ink)" }}
            >
              {item.displayName}
            </span>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {formatBytes(item.bytes)} · {STATUS_LABEL[item.status]}
            </span>
          </div>

          <div
            className="h-1.5 w-full overflow-hidden"
            style={{
              backgroundColor: "var(--color-wheat)",
              borderRadius: "var(--radius-card)",
            }}
            role="progressbar"
            aria-valuenow={Math.round(item.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.round(item.progress * 100)}%`,
                backgroundColor:
                  item.status === "error"
                    ? "var(--color-coral)"
                    : "var(--color-ink)",
              }}
            />
          </div>

          {item.duplicate ? (
            <p className="text-xs" style={{ color: "var(--color-coral)" }}>
              Looks like a duplicate of another photo you picked. It will still
              upload.
            </p>
          ) : null}
          {item.error ? (
            <p className="text-xs" style={{ color: "var(--color-coral)" }}>
              {item.error}
            </p>
          ) : null}

          <div className="flex gap-3 text-xs">
            {item.status === "uploading" ? (
              <button
                type="button"
                onClick={() => onPause(item.id)}
                style={{ color: "var(--color-ink)" }}
              >
                Pause
              </button>
            ) : null}
            {item.status === "paused" ? (
              <button
                type="button"
                onClick={() => onResume(item.id)}
                style={{ color: "var(--color-ink)" }}
              >
                Resume
              </button>
            ) : null}
            {item.status === "error" ? (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                style={{ color: "var(--color-ink)" }}
              >
                Retry
              </button>
            ) : null}
            {item.status !== "done" ? (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                style={{ color: "var(--color-muted)" }}
              >
                Remove
              </button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
