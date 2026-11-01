import type { Metadata } from "next";
import { CheerCompanion } from "@/components/cheer/CheerCompanion";

export const metadata: Metadata = {
  title: "Cheer for Rach | NYC Marathon",
  description: "Three stops. One incredible run. The race-day plan for cheering on Rach.",
  robots: { index: false, follow: false },
};

export default function CheerPage() {
  return <CheerCompanion />;
}
