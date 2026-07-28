"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

import { personHref } from "@/lib/people/person-href";

export function ShareGuestPageButton({
  personSlug,
}: {
  personSlug: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    // Share the canonical compact URL, not the catalog slug. This is handed
    // the hyphenated slug (phil-campbell), and building the link from it
    // straight would have sent every recipient of the Share button through
    // the legacy redirect -- the one surface whose entire job is producing a
    // link someone else will open. personHref is the same helper the pickers
    // use, so every path now emits the same address.
    const url = new URL(personHref(personSlug), window.location.origin).href;
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
