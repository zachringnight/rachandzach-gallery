/**
 * Add Yours (packet 08). Invited guests submit their own photos into private
 * quarantine storage for review. The (guest) layout (packet 06) supplies the
 * shell; this page re-checks the guest session (defense in depth beyond the
 * proxy) and renders the uploader.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  GalleryAccessError,
  requireGalleryAccess,
} from "@/lib/auth/guest-session";
import { UploadClient } from "./UploadClient";

export const metadata: Metadata = {
  title: "Add Your Photos | Rach & Zach",
  robots: { index: false, follow: false },
};

export default async function AddYoursPage() {
  try {
    await requireGalleryAccess();
  } catch (error) {
    if (error instanceof GalleryAccessError) {
      redirect("/enter?next=/add-yours");
    }
    throw error;
  }

  return (
    <main
      className="atlas-guest-page atlas-upload-page"
    >
      <header className="atlas-guest-header">
        <div>
          <p className="atlas-kicker">The weekend as you saw it</p>
          <h1>Add your photos</h1>
        </div>
        <p>
          The photographer could not be everywhere. Your phone was. Share what
          you caught over the weekend.
        </p>
        <span aria-hidden="true">Add another point of view</span>
      </header>

      <div className="atlas-guest-body atlas-upload-body">
        <UploadClient />
      </div>
    </main>
  );
}
