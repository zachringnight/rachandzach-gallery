import { MTA_FEED, parseTransitFeed, type TransitSnapshot } from "@/lib/cheer/transit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(MTA_FEED, {
      next: { revalidate: 60 }, signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("MTA request failed.");
    const snapshot = parseTransitFeed(await response.json());
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch {
    const snapshot: TransitSnapshot = {
      checkedAt: new Date().toISOString(), feedAt: null, status: "unavailable", alerts: [],
      message: "MTA alerts are unavailable. Check the MTA app before traveling; your itinerary is still available below.",
    };
    return Response.json(snapshot, { status: 503, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
}
