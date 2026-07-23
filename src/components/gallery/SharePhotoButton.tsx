"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

export interface SharePhotoButtonProps {
  photoId: string;
  label?: string;
  className?: string;
}

function photoPermalink(photoId: string): string {
  return new URL(
    `/photos/${encodeURIComponent(photoId)}`,
    window.location.origin,
  ).href;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

/** Shares only the private permalink, never a signed preview or storage URL. */
export function SharePhotoButton({
  photoId,
  label = "Share",
  className,
}: SharePhotoButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  const share = async () => {
    const url = photoPermalink(photoId);
    setStatus("idle");

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await copyText(url);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2200);
    } catch {
      setStatus("error");
    }
  };

  return (
    <span className="atlas-share-control">
      <button
        type="button"
        onClick={() => void share()}
        className={className ?? "atlas-lightbox-control"}
        aria-label={`${label} photo link`}
      >
        {status === "copied" ? (
          <Check aria-hidden="true" size={16} strokeWidth={1.7} />
        ) : (
          <Share2 aria-hidden="true" size={16} strokeWidth={1.7} />
        )}
        <span>{status === "copied" ? "Link copied" : label}</span>
      </button>
      <span className="sr-only" aria-live="polite">
        {status === "copied"
          ? "Link copied"
          : status === "error"
            ? "Could not copy the link"
            : ""}
      </span>
    </span>
  );
}
