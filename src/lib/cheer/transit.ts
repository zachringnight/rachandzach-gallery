import { z } from "zod";

export const MTA_FEED = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json";
export const STALE_AFTER_MS = 10 * 60_000;
export const ROUTES = ["N", "D", "Q"] as const;
export type TrainRoute = typeof ROUTES[number];

const translated = z.object({ translation: z.array(z.object({ text: z.string(), language: z.string().optional() })) });
const period = z.object({ start: z.number().nonnegative().optional(), end: z.number().nonnegative().optional() });
const feedSchema = z.object({
  header: z.object({ timestamp: z.number().positive(), incrementality: z.string().optional() }),
  entity: z.array(z.object({
    id: z.string(),
    is_deleted: z.boolean().optional(),
    alert: z.object({
      active_period: z.array(period).optional(),
      informed_entity: z.array(z.object({ route_id: z.string().optional() })),
      header_text: translated,
      description_text: translated.optional(),
      "transit_realtime.mercury_alert": z.object({
        alert_type: z.string().optional(),
        human_readable_active_period: translated.optional(),
      }).optional(),
    }).optional(),
  })),
});

export type TransitAlert = {
  id: string; routes: TrainRoute[]; title: string; description: string;
  type: string; period: string; upcoming: boolean;
};
export type TransitSnapshot = {
  checkedAt: string; feedAt: string | null; status: "fresh" | "stale" | "unavailable";
  alerts: TransitAlert[]; message?: string;
};

function english(value: z.infer<typeof translated> | undefined): string {
  const translations = value?.translation ?? [];
  return (translations.find((t) => t.language === "en") ?? translations.find((t) => !t.language))?.text ?? "";
}

export function parseTransitFeed(input: unknown, now = Date.now()): TransitSnapshot {
  const feed = feedSchema.parse(input);
  if (feed.header.incrementality && feed.header.incrementality !== "FULL_DATASET") {
    throw new Error("A complete alert snapshot is required.");
  }
  const feedMs = feed.header.timestamp * 1000;
  if (feedMs > now + 120_000) throw new Error("Feed clock is ahead of current time.");
  // Include changes that could start during the next three hours of travel.
  const horizon = now / 1000 + 3 * 60 * 60;
  const alerts: TransitAlert[] = [];
  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert || entity.is_deleted) continue;
    const routes = ROUTES.filter((route) => alert.informed_entity.some((item) => item.route_id === route));
    if (!routes.length) continue;
    const periods = alert.active_period?.length ? alert.active_period : [{}];
    const relevant = periods.filter((p) => (p.start ?? 0) <= horizon && (p.end ?? Infinity) > now / 1000);
    if (!relevant.length) continue;
    const title = english(alert.header_text);
    if (!title) throw new Error("A relevant alert has no English summary.");
    const mercury = alert["transit_realtime.mercury_alert"];
    alerts.push({
      id: entity.id, routes: [...routes], title,
      description: english(alert.description_text),
      type: mercury?.alert_type ?? "Service alert",
      period: english(mercury?.human_readable_active_period),
      upcoming: !relevant.some((p) => (p.start ?? 0) <= now / 1000),
    });
  }
  alerts.sort((a, b) => Number(a.upcoming) - Number(b.upcoming));
  return {
    checkedAt: new Date(now).toISOString(), feedAt: new Date(feedMs).toISOString(),
    status: now - feedMs > STALE_AFTER_MS ? "stale" : "fresh", alerts,
  };
}
