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
      className="atlas-upload-dropzone"
      data-dragging={dragging ? "true" : "false"}
      style={{
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span aria-hidden="true" className="atlas-dropzone-index">+</span>
      <p>Drag your photos here</p>
      <p>
        Full-resolution JPEG, PNG, WebP, or HEIC. Up to 50 photos, 50 MB each.
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="atlas-inline-action disabled:opacity-60"
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
