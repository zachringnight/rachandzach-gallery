import type { StoryPhotoContent } from "@/content/story-photos";

export interface PhotoMarqueeProps {
  photos: StoryPhotoContent[];
}

/**
 * A slow drift of weekend photographs. Purely decorative: the same images
 * carry real alt text in their chapters, so the whole strip is aria-hidden
 * and every img uses empty alt. The track is duplicated once so the CSS
 * loop (translateX(-50%)) is seamless; the drift stops entirely under
 * prefers-reduced-motion (rule lives in PublicShell).
 */
export function PhotoMarquee({ photos }: PhotoMarqueeProps) {
  if (photos.length === 0) return null;
  const loop = [...photos, ...photos];
  return (
    <div data-marquee aria-hidden="true" className="overflow-hidden border-y border-wheat bg-sand py-6">
      <div className="rz-marquee-track">
        {loop.map((photo, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${photo.id}-${index}`}
            src={photo.src}
            alt=""
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            className="h-40 w-auto rounded-card object-cover sm:h-52"
          />
        ))}
      </div>
    </div>
  );
}
