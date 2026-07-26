import { Inter, Manrope } from "next/font/google";
import { clsx } from "clsx";

import { siteConfig } from "@/content/site";

/**
 * Site typefaces (next/font, self-hosted at build time, SIL Open Font
 * License, production-safe):
 * - Manrope: the clean, contemporary display face for archive headlines and
 *   the typeset wordmark.
 * - Inter: the highly legible sans for controls, labels, and body UI.
 *
 * The `variable` names feed the fallback chain in src/styles/tokens.css
 * (--font-display / --font-body). The root layout (packet 05) should attach
 * `displayFont.variable` and `bodyFont.variable` to <html> so every page
 * resolves the real faces; until then the token fallback stacks apply.
 */
export const displayFont = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-face",
});

export const bodyFont = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body-face",
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
