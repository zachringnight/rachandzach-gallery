import type { StoryPhotoContent } from "@/content/story-photos";

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
}

/**
 * One photo-led chapter of the weekend story: full-width image beside calm
 * typography, alternating sides, no cards and no icons.
 */
export function StoryChapter({ id, kicker, title, body, photo, reverse }: StoryChapterProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div
        className={`mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:px-8 md:items-center md:gap-14 ${
          reverse ? "md:flex-row-reverse" : "md:flex-row"
        }`}
      >
        {photo ? (
          <div className="md:w-3/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
              className="rz-reveal w-full rounded-card object-cover shadow-soft"
            />
          </div>
        ) : null}
        <div className={photo ? "md:w-2/5" : "md:max-w-2xl"}>
          <p className="font-body text-xs uppercase tracking-[0.2em] text-muted">{kicker}</p>
          <h2 id={`${id}-title`} className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl">
            {title}
          </h2>
          <p className="mt-4 font-body text-base leading-relaxed text-ink">{body}</p>
        </div>
      </div>
    </section>
  );
}
