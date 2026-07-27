import type { Metadata } from "next";

import { GuestFaceManager } from "@/components/admin/GuestFaceManager";
import { loadGuestRoster } from "@/lib/admin/people-server";
import { requireAdmin } from "@/lib/auth/admin-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guests & faces | 0719 + co. Admin",
  robots: { index: false, follow: false },
};

/**
 * The guest manager (/admin/faces): every catalog guest with the face the
 * Find me picker will actually show (hand-picked override, else the
 * committed automatic crop, else initials), the 24 without a face surfaced
 * first. From here the admins hand-pick face crops, correct names, hide
 * people from guest pickers, and add people the catalog never resolved.
 * All writes land in rachandzach_person_overrides; the catalog itself is
 * never mutated from this screen.
 */
export default async function AdminFacesPage() {
  await requireAdmin();
  const roster = await loadGuestRoster();
  return <GuestFaceManager initialRoster={roster} />;
}
