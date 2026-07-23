/**
 * Guest access page (packet 04). The one door into the shared gallery: a
 * single password from the invite. Kept intentionally modest; packet 05 owns
 * the full 0719 + co. public shell, so this page leans on the design tokens
 * without inventing new site chrome.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { BrandMark } from "@/components/brand/BrandMark";
import { siteConfig } from "@/content/site";
import { storyPhotos } from "@/content/story-photos";
import { sanitizeNextPath } from "@/lib/auth/guest-session";
import { AccessForm } from "./AccessForm";

export const metadata: Metadata = {
  title: "Come on in | Rachel & Zach",
  robots: { index: false, follow: false },
};

const DEFAULT_DESTINATION = "/photos";

const ERROR_MESSAGES: Record<string, string> = {
  invalid:
    "Hmm, that is not the password we sent. Check the invite text or email and try again.",
  slow: "A few too many tries in a row. Give it a couple of minutes, then try again.",
  link: "That sign-in link did not work. It may have expired; request a fresh one and try again.",
};

interface EnterPageProps {
  searchParams?: Promise<{ error?: string; next?: string }>;
}

export default async function EnterPage({ searchParams }: EnterPageProps) {
  const params = (await searchParams) ?? {};
  const nextPath = sanitizeNextPath(params.next, DEFAULT_DESTINATION);
  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.invalid)
    : null;
  const hero = storyPhotos.hero;

  return (
    <main className="atlas-access">
      <figure className="atlas-access-image">
        <picture>
          <source media="(max-width: 720px)" srcSet="/story/hero-sunset-mobile-adobe.png" />
          <img
            src={hero.src}
            alt={hero.alt}
            width={hero.width}
            height={hero.height}
            decoding="async"
            fetchPriority="high"
          />
        </picture>
        <figcaption>
          <span>For our favorite people</span>
          <span>Santa Barbara · 0719</span>
        </figcaption>
      </figure>

      <section className="atlas-access-panel">
        <div className="atlas-access-mark">
          <BrandMark size={28} alt="0719 + co." />
          <span>Private gallery</span>
        </div>

        <div className="atlas-access-copy">
          <p className="atlas-kicker">{siteConfig.voice.eyebrow}</p>
          <h1>{siteConfig.voice.heroTitle}</h1>
          <p>
          This part of the site is just for the people who shared the weekend
          with us. Enter the password from your invite and come on in.
          </p>
          <AccessForm nextPath={nextPath} errorMessage={errorMessage} />
        </div>

        <Link href="/" className="atlas-access-home">
          Back to the weekend
        </Link>
      </section>
    </main>
  );
}
