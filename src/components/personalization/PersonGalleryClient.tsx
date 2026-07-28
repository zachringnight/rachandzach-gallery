"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { MyWeekendGallery } from "@/components/personalization/MyWeekendGallery";
import { ShareGuestPageButton } from "@/components/personalization/ShareGuestPageButton";
import { migrateFavoritesToPerson } from "@/lib/favorites/sync";
import {
  clearMyWeekendPreference,
  getMyWeekendPreference,
  setMyWeekendPreference,
} from "@/lib/personalization/my-weekend";

/**
 * One person's photographs, plus the only place a guest declares who they are.
 *
 * Claiming an identity lives HERE, behind an explicit button, rather than on
 * the Find me picker. Tapping a face in the picker only browses: guests
 * legitimately want to look at photos of the couple, their table, or anyone
 * else, and doing that must not rewrite who this browser claims to be. It
 * previously did, and worse -- the same preference is what the favorites sync
 * keys on (see getPersonSlug in src/lib/favorites/sync.ts), so opening
 * someone else's page also pushed the visitor's saved hearts onto that
 * person's record.
 *
 * So: browsing is free and silent, claiming is one deliberate tap, and only
 * claiming touches favorites.
 */
export function PersonGalleryClient({
  personSlug,
  personName,
}: {
  personSlug: string;
  personName: string;
}) {
  const router = useRouter();
  // undefined until the localStorage read lands, so server and first client
  // render agree (the same hydration concern documented in MyWeekendClient).
  const [claimedSlug, setClaimedSlug] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    void (async () => {
      setClaimedSlug(getMyWeekendPreference()?.personSlug ?? null);
    })();
  }, []);

  const claimThisPerson = useCallback(() => {
    setMyWeekendPreference(personSlug);
    // Hearts collected under the anonymous session now belong to this person.
    // Fire-and-forget: a failure leaves the local store intact and the merge
    // retries on the next sync. This is the ONLY call site -- it runs when a
    // guest says "this is me", never merely because they looked at a page.
    migrateFavoritesToPerson(personSlug);
    setClaimedSlug(personSlug);
  }, [personSlug]);

  const releaseClaim = useCallback(() => {
    clearMyWeekendPreference();
    setClaimedSlug(null);
    router.push("/my-weekend");
  }, [router]);

  const isMe = claimedSlug === personSlug;

  return (
    <div className="atlas-person-page">
      <div className="atlas-person-page-share">
        <p>
          {isMe
            ? "This private page is yours to keep and share with anyone who has the wedding password."
            : `${personName}'s photos. Share this page with anyone who has the wedding password.`}
        </p>
        <div className="atlas-person-page-actions">
          <ShareGuestPageButton personSlug={personSlug} />
          {/* Nothing renders until the preference has been read, so the claim
              button never flashes the wrong state on first paint. */}
          {claimedSlug === undefined ? null : isMe ? (
            <button
              type="button"
              onClick={releaseClaim}
              className="atlas-secondary-action"
            >
              Not {personName}?
            </button>
          ) : (
            <button
              type="button"
              onClick={claimThisPerson}
              className="atlas-secondary-action"
            >
              This is me
            </button>
          )}
        </div>
      </div>
      <MyWeekendGallery
        personSlug={personSlug}
        personName={personName}
      />
    </div>
  );
}
