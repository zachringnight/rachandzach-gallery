import Link from "next/link";

import { featureFlags, type FeatureFlagName } from "@/content/features";

export interface FeaturePortalProps {
  /**
   * Owning feature flag. When set and off, the portal renders nothing at all:
   * no placeholder, no dimmed card, no nav residue. Omit for always-on
   * portals like Add Yours.
   */
  flag?: FeatureFlagName;
  href: string;
  title: string;
  body: string;
}

/** A quiet doorway to a feature area. Gated portals vanish while flagged off. */
export function FeaturePortal({ flag, href, title, body }: FeaturePortalProps) {
  if (flag && !featureFlags[flag]) {
    return null;
  }
  return (
    <Link
      href={href}
      className="group block rounded-card border border-wheat bg-white p-6 shadow-soft focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
    >
      <h3 className="font-display text-xl text-ink">
        <span className="underline-offset-4 group-hover:underline">{title}</span>
        <span aria-hidden="true" className="ml-2 text-coral">
          &rarr;
        </span>
      </h3>
      <p className="mt-2 font-body text-sm leading-relaxed text-muted">{body}</p>
    </Link>
  );
}
