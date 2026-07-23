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
    <section className="atlas-upload-receipt">
      <p className="atlas-kicker">Received</p>
      <h2>
        Thank you! Your photos are in.
      </h2>
      <p>
        Every upload is reviewed by Rachel and Zach before it appears in the
        gallery, so you will not see these right away. Keep this receipt code to
        check on them later.
      </p>

      <div className="atlas-upload-receipt-code">
        <span>
          Receipt code
        </span>
        <code>
          {receipt.receiptToken}
        </code>
      </div>

      <div className="atlas-upload-receipt-actions">
        <a
          href={statusUrl}
          className="atlas-inline-action"
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
          className="atlas-secondary-action"
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
    </section>
  );
}
