import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Rach Runs NYC | Rach & Zach",
  description:
    "Rachel is running the 2026 TCS New York City Marathon with Team for Kids. Read her story and support the run.",
  alternates: {
    canonical: "/nyc",
  },
};

/**
 * Backward-compatible alias. Rachel's verified marathon story and donation
 * links have one canonical implementation at /nyc.
 */
export default function MarathonPage() {
  permanentRedirect("/nyc");
}
