import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainFeedMessage, parseTrainFeed, servicesForFeed, TRAIN_FEEDS } from "@/lib/cheer/arrivals-feed";
import { arrivalCountdown, arrivalStatus, ARRIVALS_STALE_MS } from "@/lib/cheer/arrivals";
import { GET } from "@/app/api/cheer/arrivals/route";

const NOW = Date.parse("2026-11-01T13:40:00Z");
const seconds = NOW / 1000;
const stop = (stopId: string, offset: number, scheduleRelationship = 0) => ({ stopId, arrival: { time: seconds + offset }, scheduleRelationship });
function trip(id = "n1", routeId = "N", stops = [stop("Q01S", 120), stop("R36S", 1200)], assigned = true, relationship = 0) {
  return { id, tripUpdate: { trip: { tripId: id, startDate: "20261101", routeId, nyct: { isAssigned: assigned }, scheduleRelationship: relationship }, stopTimeUpdate: stops } };
}
function encode(entity: unknown[] = [], timestamp = seconds, incrementality = 0) {
  return TrainFeedMessage.encode(TrainFeedMessage.fromObject({ header: { gtfsRealtimeVersion: "1.0", timestamp, incrementality }, entity })).finish();
}
const services = (entity: unknown[], key: "nqrw" | "bdfm" = "nqrw") => servicesForFeed(key, parseTrainFeed(encode(entity), NOW), NOW);
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("MTA train arrival selection", () => {
  it("matches platform, direction, route and onward destination", () => {
    const result = services([
      trip(), trip("wrong-direction", "N", [stop("Q01N", 60), stop("R36S", 1200)]),
      trip("wrong-line", "Q"), trip("short-turn", "N", [stop("Q01S", 60), stop("R31S", 900)]),
      trip("brooklyn", "N", [stop("R36N", 90), stop("R31N", 500)]),
      trip("q", "Q", [stop("D24N", 180), stop("Q05N", 1800)]),
    ]);
    expect(result.map((s) => [s.boardId, s.arrivals.map((a) => a.id)])).toEqual([
      ["canal", ["20261101:n1"]], ["36th", ["20261101:brooklyn"]], ["atlantic", ["20261101:q"]],
    ]);
    expect(result[0].arrivals[0].destinationAt).toBe(new Date(NOW + 1200_000).toISOString());
    expect(services([trip("d", "D", [stop("R36N", 90), stop("R31N", 500)])], "bdfm")[0].arrivals).toHaveLength(1);
  });
  it("excludes cancelled, deleted, unassigned, skipped, no-data and expired trains", () => {
    const deleted = { ...trip("deleted"), isDeleted: true };
    const result = services([
      deleted, trip("cancelled", "N", undefined, true, 3), trip("not-started", "N", undefined, false),
      trip("skipped", "N", [stop("Q01S", 120, 1), stop("R36S", 1200)]),
      trip("no-data", "N", [stop("Q01S", 120, 2), stop("R36S", 1200)]),
      trip("skipped-destination", "N", [stop("Q01S", 120), stop("R36S", 1200, 1)]),
      trip("past", "N", [stop("Q01S", -1), stop("R36S", 1200)]),
      trip("later", "N", [stop("Q01S", 4000), stop("R36S", 5000)]),
    ]);
    expect(result[0].arrivals).toEqual([]);
  });
  it("uses departure when arrival is absent and identifies rerouted Canal platforms", () => {
    const t = trip();
    const raw = { ...t, tripUpdate: { ...t.tripUpdate, stopTimeUpdate: [{ stopId: "R23S", departure: { time: seconds + 100 } }, stop("R36S", 900)] } };
    const arrival = services([raw])[0].arrivals[0];
    expect(arrival.platform).toBe("Broadway local platform");
    expect(arrival.at).toBe(new Date(NOW + 100_000).toISOString());
  });
  it("sorts, deduplicates trips, and limits each service to the next three", () => {
    const items = [400, 100, 300, 200].map((offset) => trip(String(offset), "N", [stop("Q01S", offset), stop("R36S", 1800)]));
    expect(services([...items, items[1]])[0].arrivals.map((a) => a.id)).toEqual(["20261101:100", "20261101:200", "20261101:300"]);
  });
  it("hides stale predictions and handles empty feeds without inventing arrivals", () => {
    const stale = servicesForFeed("nqrw", parseTrainFeed(encode([trip()], seconds - 121), NOW), NOW)[0];
    expect(stale.status).toBe("stale"); expect(stale.arrivals).toEqual([]);
    expect(services([])[0]).toMatchObject({ status: "fresh", arrivals: [] });
    expect(servicesForFeed("bdfm", null, NOW)[0]).toMatchObject({ status: "unavailable", feedAt: null, arrivals: [] });
  });
  it("rejects invalid protobuf, absent header, differential and future snapshots", () => {
    for (const data of [new Uint8Array(), new Uint8Array([255]), encode([], seconds + 61), encode([], seconds, 1)]) expect(() => parseTrainFeed(data, NOW)).toThrow();
  });
  it("discards individually stale trips even in a fresh feed", () => {
    const t = trip();
    expect(services([{ ...t, tripUpdate: { ...t.tripUpdate, timestamp: seconds - 121 } }])[0].arrivals).toEqual([]);
  });
  it("ages countdowns without showing departed trains or stale data as live", () => {
    expect(arrivalCountdown(new Date(NOW - 1).toISOString(), NOW)).toBeNull();
    expect(arrivalCountdown(new Date(NOW + 30_000).toISOString(), NOW)).toBe("<1 min");
    expect(arrivalCountdown(new Date(NOW + 61_000).toISOString(), NOW)).toBe("2 min");
    expect(arrivalStatus(services([trip()])[0], NOW + ARRIVALS_STALE_MS + 1)).toBe("stale");
  });
});

describe("train arrival endpoint", () => {
  it("fetches only fixed official feeds and preserves N/Q when D fails", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const fetch = vi.fn(async (url: string) => url === TRAIN_FEEDS.nqrw ? new Response(Buffer.from(encode([trip()]))) : new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(); const data = await response.json();
    expect(response.status).toBe(200);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(Object.values(TRAIN_FEEDS).sort());
    expect(data.services.find((s: { route: string }) => s.route === "D").status).toBe("unavailable");
    expect(data.services[0].arrivals).toHaveLength(1);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("reports total failure as unavailable, with no fabricated schedule fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await GET(); const data = await response.json();
    expect(response.status).toBe(503);
    expect(data.services).toHaveLength(4);
    expect(data.services.every((s: { status: string; arrivals: unknown[] }) => s.status === "unavailable" && s.arrivals.length === 0)).toBe(true);
  });
});
