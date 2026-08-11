"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import type { StoryPhotoContent } from "@/content/story-photos";

export interface PhotoMarqueeProps {
  photos: StoryPhotoContent[];
}

/**
 * A slow drift of photographs. The images are decorative because the
 * same frames carry real alt text elsewhere, but the motion control remains
 * available to every guest. The track is duplicated once so the CSS loop
 * (translateX(-50%)) is seamless; OS reduced-motion also stops the drift.
 */
export function PhotoMarquee({ photos }: PhotoMarqueeProps) {
  const [paused, setPaused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(media.matches);
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  if (photos.length === 0) return null;
  const loop = [...photos, ...photos];
  const motionPaused = paused || prefersReducedMotion;

  return (
    <section
      data-marquee
      data-paused={motionPaused ? "true" : "false"}
      className="atlas-marquee"
      aria-label="A few from the weekend"
    >
      <div className="atlas-marquee-label">
        <span>A few from the weekend</span>
        <button
          type="button"
          className="atlas-marquee-toggle"
          aria-pressed={motionPaused}
          disabled={prefersReducedMotion}
          onClick={() => setPaused((current) => !current)}
          title={prefersReducedMotion ? "Motion is off in your device settings" : undefined}
        >
          {motionPaused ? (
            <Play aria-hidden="true" size={14} strokeWidth={1.5} />
          ) : (
            <Pause aria-hidden="true" size={14} strokeWidth={1.5} />
          )}
          {prefersReducedMotion ? "Paused by your settings" : paused ? "Play" : "Pause"}
        </button>
      </div>
      <div className="rz-marquee-track" aria-hidden="true">
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
            className="atlas-marquee-image"
          />
        ))}
      </div>
    </section>
  );
}
