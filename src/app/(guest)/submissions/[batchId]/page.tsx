/**
 * Submission Receipt (packet 11, launch). A private receipt-token page with
 * upload counts and moderation status. "A batch id without its receipt
 * token reveals nothing": every path that cannot resolve a genuine
 * (batchId, receiptToken) pair -- a missing token, a wrong token, or a
 * batchId that does not exist -- renders the exact same opaque view (see
 * loadSubmissionReceiptView/resolveSubmissionReceiptView in
 * src/lib/modules/contracts.ts, and tests/modules/submission-status.test.ts).
 *
 * Guest-gated: this route has no entry in PUBLIC_ROUTES
 * (src/lib/auth/guest-session.ts), so proxy.ts already default-denies it to
 * anonymous requests. This page re-checks requireGalleryAccess() itself too
 * (defense in depth, matching src/app/(guest)/add-yours/page.tsx), since a
 * receipt link may be the very first URL a guest opens in a new tab.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { GalleryAccessError, requireGalleryAccess } from "@/lib/auth/guest-session";
import { getUploadStatus } from "@/lib/uploads/create-batch";
import { loadSubmissionReceiptView } from "@/lib/modules/contracts";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Submission status | Rach & Zach",
  robots: { index: false, follow: false },
};

function formatCounts(counts: {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  removed: number;
}): string {
  const parts: string[] = [`${counts.total} photo${counts.total === 1 ? "" : "s"} submitted`];
  if (counts.approved > 0) parts.push(`${counts.approved} approved`);
  if (counts.pending > 0) parts.push(`${counts.pending} still under review`);
  if (counts.rejected > 0) parts.push(`${counts.rejected} not selected`);
  return parts.join(", ") + ".";
}

export default async function SubmissionStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ receipt?: string }>;
}) {
  const { batchId } = await params;

  try {
    await requireGalleryAccess();
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      redirect(`/enter?next=${encodeURIComponent(`/submissions/${batchId}`)}`);
    }
    throw error;
  }

  const { receipt } = await searchParams;
  const view = await loadSubmissionReceiptView(batchId, receipt, { getUploadStatus });

  return (
    <section className="atlas-submission-page">
      <header className="atlas-submission-header">
        <p className="atlas-kicker">Your upload</p>
        <h1>
          Submission status
        </h1>
      </header>

      <div className="atlas-submission-card">
        {view.kind === "opaque" ? (
          <>
            <h2>We could not find that upload</h2>
            <p>
              Double-check the link from your receipt, including the code at the end of the
              address. If you still cannot find it, you are welcome to submit again from{" "}
              <Link
                href="/add-yours"
                className="atlas-text-link"
              >
                Add Yours
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <h2>{view.copy.headline}</h2>
            <p>{view.copy.body}</p>
            <p className="atlas-submission-counts">{formatCounts(view.status.counts)}</p>
            {view.status.submittedAt ? (
              <p className="atlas-submission-date">
                Submitted {new Date(view.status.submittedAt).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
