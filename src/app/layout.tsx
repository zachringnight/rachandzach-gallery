import type { Metadata, Viewport } from "next";

import { bodyFont, displayFont } from "@/components/brand/Wordmark";

import "./globals.css";

export const metadata: Metadata = {
  title: "Rach & Zach | Santa Barbara Wedding",
  description:
    "Rachel and Zach got married in Santa Barbara, California on July 19, 2025. The weekend story and photo gallery live here.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Packet 01 handoff: the next/font variables must ride <html> so the
    // token font stacks (--font-display / --font-body) resolve to the real
    // Fraunces and Inter faces instead of their fallbacks.
    //
    // suppressHydrationWarning (this element only, not children): the js-gate
    // script below adds the `js` class to <html> before React hydrates, which
    // would otherwise log a development-only className mismatch.
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable}`}
      suppressHydrationWarning
    >
      <body>
        {/* JS gate (packet 00): stamp html.js before anything below parses so
            the Reveal hidden state (see src/styles/tokens.css) only ever
            applies while JS is live. Inline and synchronous on purpose; CSP
            script-src allows 'unsafe-inline'. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add("js")`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
