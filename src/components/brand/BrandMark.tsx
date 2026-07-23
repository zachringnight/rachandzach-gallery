import { clsx } from "clsx";

/**
 * The 0719 + co. mark.
 *
 * The ONLY logo artwork on the site is the canonical outlined SVG at
 * /brand/0719-co-outline.svg (copied verbatim from the brand master; its
 * paths must never be edited). Do not draw or generate any other logo art.
 *
 * The source viewBox is 800.19 x 149.6, so the mark is roughly 5.35x wider
 * than tall. `size` is the rendered height in CSS pixels; verified legible
 * at 24px (navigation) and 96px (hero/footer).
 */
const VIEWBOX_WIDTH = 800.19;
const VIEWBOX_HEIGHT = 149.6;
const ASPECT_RATIO = VIEWBOX_WIDTH / VIEWBOX_HEIGHT;

export interface BrandMarkProps {
  /** Rendered height in pixels. Defaults to the 24px navigation size. */
  size?: number;
  /** Accessible name. Pass an empty string only when the mark is decorative. */
  alt?: string;
  className?: string;
}

export function BrandMark({ size = 24, alt = "0719 + co.", className }: BrandMarkProps) {
  const height = size;
  const width = Math.round(size * ASPECT_RATIO);
  return (
    // The mark is a static local SVG; next/image adds nothing but config here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/0719-co-outline.svg"
      alt={alt}
      height={height}
      width={width}
      decoding="async"
      className={clsx("select-none", className)}
    />
  );
}
