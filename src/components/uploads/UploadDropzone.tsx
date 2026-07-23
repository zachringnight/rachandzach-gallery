"use client";

/**
 * Drag-and-drop + file-picker surface for guest uploads (packet 08).
 *
 * The accept list deliberately excludes HEIC so iOS Safari transcodes most
 * iPhone photos to JPEG before they ever upload (per the HEIC spike); HEIC that
 * still arrives is handled server-side. The picker is the only thing this
 * component owns; validation and queueing live in the parent.
 */
import { useRef, useState } from "react";

interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic,.heif";

export function UploadDropzone({ onFiles, disabled }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  }

  return (
    <div
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      className="flex flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-12 text-center transition-opacity"
      style={{
        borderColor: dragging ? "var(--color-coral)" : "var(--color-sand)",
        backgroundColor: dragging ? "var(--color-wheat)" : "var(--color-cream)",
        borderRadius: "var(--radius-card)",
        opacity: disabled ? 0.6 : 1,
        fontFamily: "var(--font-body)",
      }}
    >
      <p className="text-base" style={{ color: "var(--color-ink)" }}>
        Drag your photos here
      </p>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        Full-resolution JPEG, PNG, WebP, or HEIC. Up to 50 photos, 50 MB each.
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-2 px-4 py-2 text-sm font-semibold uppercase tracking-wide disabled:opacity-60"
        style={{
          backgroundColor: "var(--color-ink)",
          color: "var(--color-cream)",
          borderRadius: "var(--radius-card)",
        }}
      >
        Choose photos
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          handleFiles(event.target.files);
          // Allow re-selecting the same file after a removal.
          event.target.value = "";
        }}
      />
    </div>
  );
}
