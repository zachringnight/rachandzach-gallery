import { featureFlags } from "@/content/features";
import type { ClientPhoto } from "@/lib/gallery/client-types";
import {
  isAnniversaryCapsuleVisible,
  type AnniversaryCapsuleConfig,
} from "@/lib/modules/contracts";

export interface AnniversaryCapsuleProps {
  capsule: AnniversaryCapsuleConfig | null;
  /**
   * Pre-resolved, already-signed photos for capsule.photoIds, when the
   * caller has fetched them (e.g. via getGalleryPage({ ids: capsule.photoIds
   * })). Optional: the capsule's title and body can render without them.
   */
  photos?: ClientPhoto[];
  /** Injectable for tests; defaults to the real current time. */
  now?: Date;
}

/**
 * A timed editorial module for a future anniversary. No automatic
 * publication: isAnniversaryCapsuleVisible requires BOTH the
 * anniversaryCapsule flag on AND an explicit enabledAt date at or before
 * `now`, so setting only the config's date (flag still off) or only the flag
 * (no date, or a future date) never publishes it.
 */
export function AnniversaryCapsule({ capsule, photos, now }: AnniversaryCapsuleProps) {
  if (!isAnniversaryCapsuleVisible(capsule, featureFlags.anniversaryCapsule, now)) {
    return null;
  }
  // isAnniversaryCapsuleVisible already proved capsule is non-null here.
  const { title, body } = capsule as AnniversaryCapsuleConfig;

  return (
    <section
      aria-labelledby="anniversary-capsule-title"
      className="rounded-card border border-wheat bg-white p-6 shadow-soft"
    >
      <p className="text-xs uppercase tracking-wide text-muted">One year later</p>
      <h2 id="anniversary-capsule-title" className="mt-1 font-display text-2xl text-ink">
        {title}
      </h2>
      <p className="mt-3 font-body text-sm leading-relaxed text-muted">{body}</p>
      {photos && photos.length > 0 ? (
        <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => {
            const src = photo.previews[0]?.url;
            if (!src) return null;
            return (
              <li key={photo.id} className="overflow-hidden rounded-sm bg-wheat/40">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private-storage URL. */}
                <img
                  src={src}
                  alt={photo.eventName}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
