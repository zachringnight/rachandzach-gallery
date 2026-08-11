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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  // Effect, not a bare call in the render body. Setting state during render
  // makes React re-render before committing and risks a loop; it also raced
  // the auto-submit below, which keys off this exact transition. Wrapped in
  // an async IIFE so the setState is not a synchronous statement in the
  // effect body (react-hooks/set-state-in-effect), matching the pattern used
  // elsewhere in this codebase; it still resolves on the same tick.
  useEffect(() => {
    if (!allDone || phase !== "uploading") return;
    void (async () => {
      setPhase("ready");
    })();
  }, [allDone, phase]);

  /*
   * Hand the batch in as soon as the bytes are up, instead of waiting for a
   * second click.
   *
   * Uploading only moves files into quarantine; nothing reaches /admin/review
   * until the submit call lands. So a guest who watched every progress bar
   * fill and then closed the tab used to lose the whole batch silently -- no
   * error, no receipt, and no trace anywhere an admin would look. That is the
   * worst failure this app can have: the guest believes they contributed.
   *
   * `submit` early-returns without a batch ref and flips back to "ready" on
   * failure, so the button below survives as the retry path.
   */
  const autoSubmit = allDone && phase === "ready" && !error;
  useEffect(() => {
    if (autoSubmit) void submit();
  }, [autoSubmit, submit]);

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
    <div className="atlas-upload-workspace">
      <UploadDropzone onFiles={addFiles} disabled={!collecting} />

      {collecting ? (
        <fieldset className="atlas-upload-fields">
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name (optional)"
            maxLength={120}
            className="atlas-form-field"
          />
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email, if you want a heads-up when they're live (optional)"
            className="atlas-form-field"
          />
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="A note for Rachel and Zach (optional)"
            maxLength={2000}
            rows={3}
            className="atlas-form-field"
          />
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="atlas-form-error">
          {error}
        </p>
      ) : null}

      <UploadQueue items={items} {...controls} />

      <p className="atlas-upload-note">
        Every photo is reviewed by Rachel and Zach before it appears in the
        gallery.
      </p>

      <div className="atlas-upload-actions">
        {collecting ? (
          <button
            type="button"
            onClick={() => void start()}
            disabled={items.length === 0}
            /* The disabled treatment lives in globals.css
               (.atlas-upload-actions button:disabled). opacity-40 made the
               label unreadable. */
            className="atlas-inline-action"
          >
            Upload {items.length > 0 ? `${items.length} ` : ""}photos
          </button>
        ) : null}
        {/* Only reachable when auto-submit failed: the effect above hands the
            batch in on its own, and only an error keeps the guest here. */}
        {phase === "ready" ? (
          <button
            type="button"
            onClick={() => void submit()}
            className="atlas-inline-action"
          >
            Try sending again
          </button>
        ) : null}
        {phase === "submitting" ? (
          <span className="atlas-upload-note">
            Sending your photos to Rach and Zach...
          </span>
        ) : null}
      </div>
    </div>
  );
}
