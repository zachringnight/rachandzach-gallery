"use client";

import { useRouter } from "next/navigation";

import { MyWeekendGallery } from "@/components/personalization/MyWeekendGallery";
import { ShareGuestPageButton } from "@/components/personalization/ShareGuestPageButton";
import { clearMyWeekendPreference } from "@/lib/personalization/my-weekend";

export function PersonGalleryClient({
  personSlug,
  personName,
}: {
  personSlug: string;
  personName: string;
}) {
  const router = useRouter();
  return (
    <div className="atlas-person-page">
      <div className="atlas-person-page-share">
        <p>
          This private page is yours to keep and share with anyone who has the
          wedding password.
        </p>
        <ShareGuestPageButton personSlug={personSlug} />
      </div>
      <MyWeekendGallery
        personSlug={personSlug}
        personName={personName}
        // Clear before navigating: Find me now forwards a saved preference
        // straight back to this page, so leaving it set would bounce "Not
        // you?" right back here instead of showing the picker.
        onChangePerson={() => {
          clearMyWeekendPreference();
          router.push("/my-weekend");
        }}
      />
    </div>
  );
}
