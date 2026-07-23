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
    <ul className="atlas-upload-queue">
      {items.map((item) => (
        <li
          key={item.id}
          className="atlas-upload-queue-item"
          data-status={item.status}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium">
              {item.displayName}
            </span>
            <span className="text-xs text-muted">
              {formatBytes(item.bytes)} · {STATUS_LABEL[item.status]}
            </span>
          </div>

          <div
            className="atlas-upload-progress"
            role="progressbar"
            aria-valuenow={Math.round(item.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="atlas-upload-progress-bar"
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

          <div className="atlas-upload-queue-actions">
            {item.status === "uploading" ? (
              <button
                type="button"
                onClick={() => onPause(item.id)}
                className="atlas-upload-queue-action"
              >
                Pause
              </button>
            ) : null}
            {item.status === "paused" ? (
              <button
                type="button"
                onClick={() => onResume(item.id)}
                className="atlas-upload-queue-action"
              >
                Resume
              </button>
            ) : null}
            {item.status === "error" ? (
              <button
                type="button"
                onClick={() => onRetry(item.id)}
                className="atlas-upload-queue-action"
              >
                Retry
              </button>
            ) : null}
            {item.status !== "done" ? (
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="atlas-upload-queue-action atlas-upload-queue-remove"
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
