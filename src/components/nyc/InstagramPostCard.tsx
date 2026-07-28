import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { hasInstagramPost, instagramPost } from "@/content/nyc";

/**
 * Rachel's marathon post on Instagram, as a locally rendered card that links
 * out to the real post.
 *
 * This is deliberately NOT Instagram's official embed. That embed loads
 * https://www.instagram.com/embed.js and injects a third-party iframe, and
 * this site's Content Security Policy (src/lib/auth/security-headers.ts)
 * allows neither: script-src is 'self' plus two pinned Google/Dropbox paths,
 * and frame-src is 'none' unless Drive or Dropbox is configured. The CSP is
 * applied globally by both next.config.ts and proxy.ts, so relaxing it for one
 * post would relax it for the authenticated gallery too. The full reasoning,
 * and the exact one-line change if a live embed is ever wanted, is documented
 * in src/content/nyc.ts.
 *
 * Degradation, in order:
 *   - no permalink        -> renders nothing
 *   - permalink, no still -> a typographic card that still links out
 *   - permalink + still   -> the still, framed, linking out
 * There is no state in which this renders a blocked or broken embed.
 */
export function InstagramPostCard() {
  if (!hasInstagramPost() || !instagramPost.postUrl) {
    return null;
  }

  const { image, handle, postedOn, excerpt } = instagramPost;
  // The link's accessible name has to say where it goes; the image alt
  // describes the picture, so the two must not be the same sentence.
  const label = handle
    ? `See Rachel's marathon post on Instagram (${handle})`
    : "See Rachel's marathon post on Instagram";

  return (
    <Link
      className="atlas-nyc-post"
      href={instagramPost.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      data-variant={image ? "still" : "type"}
    >
      <figure>
        {image ? (
          <span className="atlas-nyc-post-frame">
            <Image
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              sizes="(max-width: 880px) 100vw, 34vw"
            />
          </span>
        ) : null}
        <figcaption>
          <span className="atlas-kicker">
            On Instagram{postedOn ? ` · ${postedOn}` : ""}
          </span>
          <span className="atlas-nyc-post-title">
            {excerpt ?? "Rach on why she is running New York."}
          </span>
          <span className="atlas-nyc-post-action">
            {handle ?? "View the post"}
            <ArrowUpRight aria-hidden="true" size={15} />
          </span>
        </figcaption>
      </figure>
    </Link>
  );
}
