"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

export function ShareGuestPageButton({
  personSlug,
}: {
  personSlug: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = new URL(
      `/${encodeURIComponent(personSlug)}`,
      window.location.origin,
    ).href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className="atlas-share-control">
      <button
        type="button"
        onClick={() => void handleShare()}
        className="atlas-secondary-action"
      >
        {copied ? (
          <Check aria-hidden="true" size={15} strokeWidth={1.6} />
        ) : (
          <Share2 aria-hidden="true" size={15} strokeWidth={1.6} />
        )}
        {copied ? "Link copied" : "Share this page"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </span>
  );
}
