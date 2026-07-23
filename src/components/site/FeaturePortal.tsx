import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

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
      className="atlas-portal"
    >
      <span className="atlas-portal-title">{title}</span>
      <p>{body}</p>
      <ArrowUpRight aria-hidden="true" size={21} strokeWidth={1.4} />
    </Link>
  );
}
