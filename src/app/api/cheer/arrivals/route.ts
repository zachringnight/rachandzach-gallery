import { TRAIN_FEEDS, parseTrainFeed, servicesForFeed, type TrainFeed } from "@/lib/cheer/arrivals-feed";
import type { ArrivalsSnapshot } from "@/lib/cheer/arrivals";

export const runtime = "nodejs";

export async function GET() {
  const services = await Promise.all((Object.keys(TRAIN_FEEDS) as TrainFeed[]).map(async (key) => {
    try {
      const response = await fetch(TRAIN_FEEDS[key], { next: { revalidate: 15 }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error("MTA unavailable");
      const feed = parseTrainFeed(new Uint8Array(await response.arrayBuffer()));
      return servicesForFeed(key, feed);
    } catch { return servicesForFeed(key, null); }
  }));
  const snapshot: ArrivalsSnapshot = { checkedAt: new Date().toISOString(), services: services.flat() };
  return Response.json(snapshot, {
    status: snapshot.services.every((service) => service.status === "unavailable") ? 503 : 200,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
