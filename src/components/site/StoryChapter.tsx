import type { StoryPhotoContent } from "@/content/story-photos";
import { focalObjectPosition } from "@/content/story-photos";
import { Reveal } from "@/components/motion/Reveal";

export interface StoryChapterProps {
  /** Anchor id for deep links (e.g. /#ceremony, /weekend#after-party). */
  id: string;
  /** Small label above the title, e.g. a day or time of day. */
  kicker: string;
  title: string;
  body: string;
  /** Optional chapter photograph; text-only chapters render without one. */
  photo?: StoryPhotoContent;
  /** Alternate the photo side for editorial rhythm. */
  reverse?: boolean;
  /** Atlas sequence number. */
  number?: string;
}

/**
 * One photo-led chapter of the weekend story: full-width image beside calm
 * typography, alternating sides, no cards and no icons.
 */
export function StoryChapter({
  id,
  kicker,
  title,
  body,
  photo,
  reverse,
  number,
}: StoryChapterProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="atlas-story-chapter"
      data-reverse={reverse ? "true" : "false"}
    >
      <div className="atlas-story-grid">
        {photo ? (
          <Reveal as="figure" className="atlas-story-image" y={34}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
              style={{ objectPosition: focalObjectPosition(photo) }}
            />
            <figcaption>
              <span>{number ?? "00"} / 05</span>
              <span>{photo.alt}</span>
            </figcaption>
          </Reveal>
        ) : null}
        <Reveal className="atlas-story-copy" y={22}>
          <span className="atlas-story-number" aria-hidden="true">
            {number ?? "00"}
          </span>
          <p className="atlas-kicker">{kicker}</p>
          <h2 id={`${id}-title`}>
            {title}
          </h2>
          <p>{body}</p>
        </Reveal>
      </div>
    </section>
  );
}
