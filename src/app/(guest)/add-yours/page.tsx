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
  title: "Add your photos",
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
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-12"
      style={{ fontFamily: "var(--font-body)", color: "var(--color-ink)" }}
    >
      <header className="flex flex-col gap-2">
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Add your photos
        </h1>
        <p className="text-base" style={{ color: "var(--color-muted)" }}>
          The photographer could not be everywhere. Your phone was. Share what
          you caught over the weekend.
        </p>
      </header>

      <UploadClient />
    </main>
  );
}
