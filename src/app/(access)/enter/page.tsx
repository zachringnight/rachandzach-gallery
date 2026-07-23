/**
 * Guest access page (packet 04). The one door into the shared gallery: a
 * single password from the invite. Kept intentionally modest; packet 05 owns
 * the full 0719 + co. public shell, so this page leans on the design tokens
 * without inventing new site chrome.
 */
import type { Metadata } from "next";
import { siteConfig } from "@/content/site";
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

  return (
    <main
      className="flex min-h-screen items-center justify-center px-6 py-16"
      style={{ backgroundColor: "var(--color-cream)", color: "var(--color-ink)" }}
    >
      <div
        className="w-full max-w-md px-8 py-10"
        style={{
          backgroundColor: "var(--color-white)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: "var(--color-muted)", fontFamily: "var(--font-body)" }}
        >
          {siteConfig.voice.eyebrow}
        </p>
        <h1
          className="mt-3 text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {siteConfig.voice.heroTitle}
        </h1>
        <p
          className="mt-4 text-sm leading-relaxed"
          style={{ color: "var(--color-muted)", fontFamily: "var(--font-body)" }}
        >
          This part of the site is just for the people who shared the weekend
          with us. Enter the password from your invite and come on in.
        </p>
        <AccessForm nextPath={nextPath} errorMessage={errorMessage} />
      </div>
    </main>
  );
}
