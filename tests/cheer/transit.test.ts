import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTransitFeed, STALE_AFTER_MS } from "@/lib/cheer/transit";
import { GET } from "@/app/api/cheer/transit/route";

const NOW = Date.parse("2026-11-01T13:00:00Z");
const seconds = NOW / 1000;
function alert(id: string, route: string, start: number, end: number) {
  return { id, alert: {
    active_period: [{ start, end }], informed_entity: [{ route_id: route }],
    header_text: { translation: [{ language: "en", text: `${route} service notice` }] },
  } };
}
const feed = (entities: ReturnType<typeof alert>[] = []) => ({ header: { timestamp: seconds, incrementality: "FULL_DATASET" }, entity: entities });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("MTA alert selection and freshness", () => {
  it("includes current and near-future N/D/Q alerts, excluding expired and other routes", () => {
    const data = parseTransitFeed(feed([
      alert("current", "N", seconds - 10, seconds + 300),
      alert("upcoming", "Q", seconds + 3600, seconds + 7200),
      alert("expired", "D", seconds - 100, seconds),
      alert("next-week", "Q", seconds + 604800, seconds + 605800),
      alert("other", "A", seconds - 10, seconds + 300),
    ]), NOW);
    expect(data.alerts.map((a) => [a.id, a.upcoming])).toEqual([["current", false], ["upcoming", true]]);
    expect(data.status).toBe("fresh");
  });
  it("handles multiple active periods and undated alerts", () => {
    const item = alert("multi", "D", seconds - 500, seconds - 200);
    item.alert.active_period.push({ start: seconds + 500, end: seconds + 1000 });
    expect(parseTransitFeed(feed([item]), NOW).alerts[0].upcoming).toBe(true);
    expect(parseTransitFeed({ ...feed(), entity: [{ id: "undated", alert: { informed_entity: [{ route_id: "Q" }], header_text: { translation: [{ text: "Check station signs", language: "en" }] } } }] }, NOW).alerts[0].upcoming).toBe(false);
  });
  it("never labels an old empty feed as fresh", () => {
    expect(parseTransitFeed(feed(), NOW + STALE_AFTER_MS + 1).status).toBe("stale");
  });
  it("rejects missing, partial, malformed, and future-dated snapshots", () => {
    expect(() => parseTransitFeed({}, NOW)).toThrow();
    expect(() => parseTransitFeed({ header: { timestamp: seconds } }, NOW)).toThrow();
    expect(() => parseTransitFeed({ ...feed(), header: { timestamp: seconds, incrementality: "DIFFERENTIAL" } }, NOW)).toThrow();
    expect(() => parseTransitFeed(feed(), NOW - 180_000)).toThrow();
  });
});

describe("transit endpoint", () => {
  it("returns a bounded snapshot from the fixed public feed", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetch = vi.fn().mockResolvedValue(Response.json(feed([alert("delay", "N", seconds - 1, seconds + 300)])));
    vi.stubGlobal("fetch", fetch);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).alerts).toHaveLength(1);
    expect(fetch.mock.calls[0][0]).toMatch(/^https:\/\/api-endpoint\.mta\.info\//);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it.each(["network", "malformed", "upstream"])("fails explicitly when %s fails", async (failure) => {
    const fetch = failure === "network" ? vi.fn().mockRejectedValue(new Error("offline")) : vi.fn().mockResolvedValue(failure === "malformed" ? Response.json({}) : new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET();
    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.status).toBe("unavailable");
    expect(data.message).toContain("MTA alerts are unavailable");
    expect(data.feedAt).toBeNull();
  });
});
