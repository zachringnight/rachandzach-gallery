import { Fraunces, IBM_Plex_Mono, Inter } from "next/font/google";
import { clsx } from "clsx";

import { siteConfig } from "@/content/site";

/**
 * Site typefaces (next/font, self-hosted at build time, SIL Open Font
 * License, production-safe):
 * Three roles, not one face at three sizes (P7):
 * - Fraunces: the display face for headlines. A warm editorial serif with
 *   optical sizing, chosen so the headlines finally speak to the `0719 + co.`
 *   mark, which has always been a serif while every headline was a geometric
 *   sans. Manrope did this job before and paired with Inter as the safest
 *   combination available, which is exactly why the pages read as templated.
 * - Inter: the highly legible sans for controls, labels, and body UI.
 * - IBM Plex Mono: the archive voice for data about photographs.
 *
 * The `variable` names feed the fallback chain in src/styles/tokens.css
 * (--font-display / --font-body / --font-archive). The root layout attaches
 * each `.variable` to <html> so every page resolves the real faces; until
 * then the token fallback stacks apply.
 */
/*
 * SOFT and opsz only. Fraunces' WONK axis swaps in the quirky alternate
 * letterforms (the curled single-story `g`, the swashed `y`), which read as
 * decorative noise at headline size rather than as character. The axis is not
 * loaded at all so no stylesheet can reintroduce it by accident.
 */
export const displayFont = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-face",
  axes: ["SOFT", "opsz"],
});

export const bodyFont = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body-face",
});

/**
 * The archive voice: frame counts, capture times, positions, eyebrows, and
 * anything else that is data about a photograph rather than prose. Giving
 * that material its own monospaced face is what turns three sizes of one
 * font into an actual system.
 */
export const archiveFont = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-archive-face",
});

export interface WordmarkProps {
  className?: string;
}

/**
 * The typeset site lockup: the couple's names in the display face.
 * This is typography, not logo artwork; the only logo artwork is the
 * canonical outline SVG rendered by BrandMark.
 */
export function Wordmark({ className }: WordmarkProps) {
  const { primary, secondary } = siteConfig.names;
  return (
    <span
      className={clsx(
        displayFont.className,
        "tracking-tight text-ink",
        className,
      )}
    >
      {primary}
      <span aria-hidden="true"> &amp; </span>
      <span className="sr-only"> and </span>
      {secondary}
    </span>
  );
}
