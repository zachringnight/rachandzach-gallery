"use client";

/**
 * Upload receipt (packet 08). Shows the opaque receipt code and a local status
 * link the guest can revisit. It states plainly that photos are reviewed before
 * they appear. No email is sent from here (that is packet 10).
 */
import { useState } from "react";
import type { UploadReceiptData } from "./types";

interface UploadReceiptProps {
  receipt: UploadReceiptData;
}

export function UploadReceipt({ receipt }: UploadReceiptProps) {
  const [copied, setCopied] = useState(false);
  const statusUrl = `${receipt.statusPath}?receipt=${encodeURIComponent(
    receipt.receiptToken,
  )}`;

  return (
    <section
      className="flex flex-col gap-4 border px-6 py-6"
      style={{
        borderColor: "var(--color-sand)",
        borderRadius: "var(--radius-card)",
        backgroundColor: "var(--color-cream)",
        fontFamily: "var(--font-body)",
      }}
    >
      <h2
        className="text-lg font-semibold"
        style={{ color: "var(--color-ink)", fontFamily: "var(--font-display)" }}
      >
        Thank you! Your photos are in.
      </h2>
      <p className="text-sm" style={{ color: "var(--color-ink)" }}>
        Every upload is reviewed by Rachel and Zach before it appears in the
        gallery, so you will not see these right away. Keep this receipt code to
        check on them later.
      </p>

      <div
        className="flex flex-col gap-1 px-4 py-3"
        style={{
          backgroundColor: "var(--color-white)",
          borderRadius: "var(--radius-card)",
        }}
      >
        <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
          Receipt code
        </span>
        <code className="break-all text-sm" style={{ color: "var(--color-ink)" }}>
          {receipt.receiptToken}
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a
          href={statusUrl}
          className="px-4 py-2 font-semibold uppercase tracking-wide"
          style={{
            backgroundColor: "var(--color-ink)",
            color: "var(--color-cream)",
            borderRadius: "var(--radius-card)",
          }}
        >
          Check status
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(receipt.receiptToken)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => setCopied(false));
          }}
          style={{ color: "var(--color-ink)" }}
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
    </section>
  );
}
