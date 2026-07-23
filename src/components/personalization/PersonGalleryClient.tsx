"use client";

import { useRouter } from "next/navigation";

import { MyWeekendGallery } from "@/components/personalization/MyWeekendGallery";
import { ShareGuestPageButton } from "@/components/personalization/ShareGuestPageButton";

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
        onChangePerson={() => router.push("/my-weekend")}
      />
    </div>
  );
}
