"use client";

/**
 * Guest upload orchestrator (packet 08).
 *
 * Flow: create a draft batch -> per file, request a signed target and upload
 * the bytes directly to Supabase Storage over resumable TUS -> submit the batch
 * for review. File bytes never transit our server; only tiny JSON does.
 *
 * Resumability, pause/resume/retry, and progress come from tus-js-client, which
 * is the same engine Uppy's TUS plugin wraps. The verified spike config is
 * applied verbatim: the signed `/upload/resumable/sign` endpoint, a 6 MB chunk
 * size, the per-file `x-signature` token header, `removeFingerprintOnSuccess`,
 * and `uploadDataDuringCreation`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import * as tus from "tus-js-client";
import {
  GUEST_PENDING_BUCKET,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  UPLOAD_TUS_CHUNK_SIZE,
  UPLOAD_TUS_RETRY_DELAYS,
  type SignedUploadTarget,
  type UploadBatchReceipt,
} from "@/lib/uploads/contracts";
import { sniffImage } from "@/lib/uploads/validate-upload";
import { UploadDropzone } from "@/components/uploads/UploadDropzone";
import { UploadQueue } from "@/components/uploads/UploadQueue";
import { UploadReceipt } from "@/components/uploads/UploadReceipt";
import type { QueueItem, UploadReceiptData } from "@/components/uploads/types";

const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const SNIFF_TO_MIME: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

type Phase = "collecting" | "uploading" | "ready" | "submitting" | "done";

async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}

export function UploadClient() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [phase, setPhase] = useState<Phase>("collecting");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<UploadReceiptData | null>(null);

  const uploadsRef = useRef<Map<string, tus.Upload>>(new Map());
  const batchRef = useRef<UploadBatchReceipt | null>(null);

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }, []);

  const addFiles = useCallback(async (files: File[]) => {
    setError(null);
    const additions: QueueItem[] = [];
    for (const file of files) {
      const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
      const mediaType = SNIFF_TO_MIME[sniffImage(head)];
      if (!mediaType) {
        setError(
          `"${file.name}" is not a JPEG, PNG, WebP, or HEIC photo, so it was skipped.`,
        );
        continue;
      }
      if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
        setError(`"${file.name}" is larger than 50 MB, so it was skipped.`);
        continue;
      }
      additions.push({
        id: crypto.randomUUID(),
        file,
        displayName: file.name,
        bytes: file.size,
        mediaType,
        progress: 0,
        status: "queued",
      });
    }

    setItems((prev) => {
      const seen = new Set(prev.map((item) => `${item.displayName}:${item.bytes}`));
      const merged = [...prev];
      for (const addition of additions) {
        if (merged.length >= MAX_FILES_PER_BATCH) {
          setError(`You can upload up to ${MAX_FILES_PER_BATCH} photos at a time.`);
          break;
        }
        const key = `${addition.displayName}:${addition.bytes}`;
        addition.duplicate = seen.has(key);
        seen.add(key);
        merged.push(addition);
      }
      return merged;
    });
  }, []);

  const uploadOne = useCallback(
    async (item: QueueItem, batch: UploadBatchReceipt) => {
      patchItem(item.id, { status: "signing", error: undefined });

      const sha256 = await sha256Hex(item.file);
      const signResponse = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          batchId: batch.batchId,
          receiptToken: batch.receiptToken,
          file: {
            originalName: item.displayName,
            declaredType: item.mediaType,
            bytes: item.bytes,
            sha256,
          },
        }),
      });
      if (!signResponse.ok) {
        patchItem(item.id, {
          status: "error",
          error: "Could not prepare this photo for upload.",
        });
        return;
      }
      const target = (await signResponse.json()) as SignedUploadTarget;

      const upload = new tus.Upload(item.file, {
        endpoint: target.tusEndpoint,
        chunkSize: UPLOAD_TUS_CHUNK_SIZE,
        retryDelays: [...UPLOAD_TUS_RETRY_DELAYS],
        removeFingerprintOnSuccess: true,
        uploadDataDuringCreation: true,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          "x-signature": target.signedToken,
        },
        metadata: {
          bucketName: GUEST_PENDING_BUCKET,
          objectName: target.objectPath,
          contentType: item.mediaType,
          cacheControl: "3600",
        },
        onError: () => {
          patchItem(item.id, {
            status: "error",
            error: "Upload interrupted. You can retry.",
          });
        },
        onProgress: (sent, total) => {
          patchItem(item.id, {
            status: "uploading",
            progress: total > 0 ? sent / total : 0,
          });
        },
        onSuccess: () => {
          patchItem(item.id, { status: "done", progress: 1 });
        },
      });
      uploadsRef.current.set(item.id, upload);

      const previous = await upload.findPreviousUploads();
      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
      patchItem(item.id, { status: "uploading" });
      upload.start();
    },
    [patchItem],
  );

  const start = useCallback(async () => {
    if (items.length === 0) return;
    setError(null);
    setPhase("uploading");
    try {
      const response = await fetch("/api/uploads/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          email: email.trim() || null,
          note: note.trim() || null,
          itemCount: items.length,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Could not start the upload.");
        setPhase("collecting");
        return;
      }
      const batch = (await response.json()) as UploadBatchReceipt;
      batchRef.current = batch;
      await Promise.all(items.map((item) => uploadOne(item, batch)));
    } catch {
      setError("Something went wrong starting the upload.");
      setPhase("collecting");
    }
  }, [items, displayName, email, note, uploadOne]);

  const submit = useCallback(async () => {
    const batch = batchRef.current;
    if (!batch) return;
    setPhase("submitting");
    setError(null);
    try {
      const response = await fetch(
        `/api/uploads/batches/${batch.batchId}/submit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ receiptToken: batch.receiptToken }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Could not submit for review.");
        setPhase("ready");
        return;
      }
      setReceipt({
        batchId: batch.batchId,
        receiptToken: batch.receiptToken,
        // Packet 11 built the human-facing status page at this path
        // (src/app/(guest)/submissions/[batchId]/page.tsx); UploadReceipt
        // appends "?receipt=<token>" itself. Previously this pointed at the
        // raw JSON status API, which is still what the page reads from
        // server-side, but is not something a guest should land on directly.
        statusPath: `/submissions/${batch.batchId}`,
      });
      setPhase("done");
    } catch {
      setError("Something went wrong submitting for review.");
      setPhase("ready");
    }
  }, []);

  const allDone = useMemo(
    () => items.length > 0 && items.every((item) => item.status === "done"),
    [items],
  );
  if (allDone && phase === "uploading") {
    setPhase("ready");
  }

  const controls = useMemo(
    () => ({
      onPause: (id: string) => {
        uploadsRef.current.get(id)?.abort();
        patchItem(id, { status: "paused" });
      },
      onResume: (id: string) => {
        patchItem(id, { status: "uploading" });
        void uploadsRef.current.get(id)?.start();
      },
      onRetry: (id: string) => {
        patchItem(id, { status: "uploading", error: undefined });
        void uploadsRef.current.get(id)?.start();
      },
      onRemove: (id: string) => {
        void uploadsRef.current.get(id)?.abort(true);
        uploadsRef.current.delete(id);
        setItems((prev) => prev.filter((item) => item.id !== id));
      },
    }),
    [patchItem],
  );

  if (phase === "done" && receipt) {
    return <UploadReceipt receipt={receipt} />;
  }

  const collecting = phase === "collecting";

  return (
    <div className="flex flex-col gap-6">
      <UploadDropzone onFiles={addFiles} disabled={!collecting} />

      {collecting ? (
        <fieldset
          className="flex flex-col gap-3"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name (optional)"
            maxLength={120}
            className="w-full border px-4 py-3 text-base outline-none"
            style={fieldStyle}
          />
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email, if you want a heads-up when they're live (optional)"
            className="w-full border px-4 py-3 text-base outline-none"
            style={fieldStyle}
          />
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="A note for Rachel and Zach (optional)"
            maxLength={2000}
            rows={3}
            className="w-full border px-4 py-3 text-base outline-none"
            style={fieldStyle}
          />
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm" style={{ color: "var(--color-coral)" }}>
          {error}
        </p>
      ) : null}

      <UploadQueue items={items} {...controls} />

      <p className="text-sm" style={{ color: "var(--color-muted)", fontFamily: "var(--font-body)" }}>
        Every photo is reviewed by Rachel and Zach before it appears in the
        gallery.
      </p>

      <div className="flex gap-3">
        {collecting ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={items.length === 0}
            className="px-5 py-3 text-sm font-semibold uppercase tracking-wide disabled:opacity-60"
            style={primaryButtonStyle}
          >
            Upload {items.length > 0 ? `${items.length} ` : ""}photos
          </button>
        ) : null}
        {phase === "ready" ? (
          <button
            type="button"
            onClick={() => void submit()}
            className="px-5 py-3 text-sm font-semibold uppercase tracking-wide"
            style={primaryButtonStyle}
          >
            Submit for review
          </button>
        ) : null}
        {phase === "submitting" ? (
          <span className="text-sm" style={{ color: "var(--color-muted)" }}>
            Submitting...
          </span>
        ) : null}
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  borderColor: "var(--color-sand)",
  borderRadius: "var(--radius-card)",
  backgroundColor: "var(--color-cream)",
  color: "var(--color-ink)",
};

const primaryButtonStyle: CSSProperties = {
  backgroundColor: "var(--color-ink)",
  color: "var(--color-cream)",
  borderRadius: "var(--radius-card)",
  fontFamily: "var(--font-body)",
};
