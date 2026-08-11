/**
 * Add Yours (packet 08). Guests submit their own photos into private
 * quarantine storage for review. The (guest) layout (packet 06) supplies the
 * shell.
 *
 * Open since the password gate was removed (2026-08-09): anyone with the URL
 * can submit. Nothing they submit is published by that act -- every upload
 * lands in quarantine and waits for admin review, which is still behind
 * Supabase auth.
 */
import type { Metadata } from "next";
import { UploadClient } from "./UploadClient";

export const metadata: Metadata = {
  title: "Add Your Photos | Rach & Zach",
  robots: { index: false, follow: false },
};

export default async function AddYoursPage() {
  return (
    <main
      className="atlas-guest-page atlas-upload-page"
    >
      <header className="atlas-page-bar">
        <h1>Add your photos</h1>
        <p className="atlas-page-bar-note">
          Add the photos only you have. Rachel and Zach look at every one
          before it goes up.
        </p>
      </header>

      <div className="atlas-guest-body atlas-upload-body">
        <UploadClient />
      </div>
    </main>
  );
}
