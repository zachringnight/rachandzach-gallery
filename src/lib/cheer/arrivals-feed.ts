import protobuf from "protobufjs";
import { z } from "zod";
import { ARRIVAL_BOARDS, ARRIVALS_STALE_MS, type ArrivalService, type TrainArrival } from "./arrivals";

export const TRAIN_FEEDS = {
  nqrw: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
  bdfm: "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
} as const;
export type TrainFeed = keyof typeof TRAIN_FEEDS;

// Wire-compatible subset of the official GTFS-RT and NYCT extension schemas.
// Unknown fields are skipped by protobufjs. No custom binary decoding.
// https://github.com/MobilityData/gtfs-realtime-bindings/blob/master/gtfs-realtime.proto
// https://www.mta.info/developers (NYC Subway protobuf extension)
export const TrainFeedMessage = protobuf.parse(`syntax = "proto2";
message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader { required string gtfs_realtime_version = 1; optional uint32 incrementality = 2; required uint64 timestamp = 3; }
message FeedEntity { required string id = 1; optional bool is_deleted = 2; optional TripUpdate trip_update = 3; }
message TripUpdate { required TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; optional uint64 timestamp = 4; }
message TripDescriptor { optional string trip_id = 1; optional string start_date = 3; optional uint32 schedule_relationship = 4; optional string route_id = 5; optional NyctTrip nyct = 1001; }
message NyctTrip { optional bool is_assigned = 2; }
message StopTimeUpdate { optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; optional string stop_id = 4; optional uint32 schedule_relationship = 5; }
message StopTimeEvent { optional int64 time = 2; }
`).root.lookupType("FeedMessage");

const timestamp = z.number().int().positive().max(8_640_000_000_000);
const event = z.object({ time: timestamp.optional() });
const stopSchema = z.object({ stopId: z.string().optional(), arrival: event.optional(), departure: event.optional(), scheduleRelationship: z.number().optional() });
const schema = z.object({
  header: z.object({ gtfsRealtimeVersion: z.string().min(1), timestamp, incrementality: z.number().optional() }),
  entity: z.array(z.object({
    id: z.string(), isDeleted: z.boolean().optional(),
    tripUpdate: z.object({
      timestamp: timestamp.optional(),
      trip: z.object({ tripId: z.string().optional(), startDate: z.string().optional(), routeId: z.string().optional(), scheduleRelationship: z.number().optional(), nyct: z.object({ isAssigned: z.boolean().optional() }).optional() }),
      stopTimeUpdate: z.array(stopSchema),
    }).optional(),
  })),
});

export function parseTrainFeed(bytes: Uint8Array, now = Date.now()) {
  if (!bytes.length || bytes.length > 2_000_000) throw new Error("Invalid feed size");
  const decoded = TrainFeedMessage.toObject(TrainFeedMessage.decode(bytes), { longs: Number, arrays: true });
  const feed = schema.parse(decoded);
  if ((feed.header.incrementality ?? 0) !== 0 || feed.header.timestamp * 1000 > now + 60_000) throw new Error("Invalid feed snapshot");
  return feed;
}
type ParsedFeed = ReturnType<typeof parseTrainFeed>;

function servesStop(stop: z.infer<typeof stopSchema>) {
  return stop.scheduleRelationship === undefined || stop.scheduleRelationship === 0 || stop.scheduleRelationship === 3;
}

export function servicesForFeed(key: TrainFeed, feed: ParsedFeed | null, now = Date.now()): ArrivalService[] {
  const feedAt = feed ? new Date(feed.header.timestamp * 1000).toISOString() : null;
  const status = !feed ? "unavailable" : now - feed.header.timestamp * 1000 > ARRIVALS_STALE_MS ? "stale" : "fresh";
  return ARRIVAL_BOARDS.flatMap((board) => board.routes.flatMap((route): ArrivalService[] => {
    if ((route === "D" ? "bdfm" : "nqrw") !== key) return [];
    const arrivals = new Map<string, TrainArrival>();
    if (feed && status === "fresh") for (const entity of feed.entity) {
      const update = entity.tripUpdate;
      if (entity.isDeleted || !update || update.trip.routeId !== route || !update.trip.tripId) continue;
      // Do not present unassigned scheduled trips as live approaching trains.
      if (update.trip.nyct?.isAssigned !== true || ![0, 1, 2, 6].includes(update.trip.scheduleRelationship ?? 0)) continue;
      if (update.timestamp && (now - update.timestamp * 1000 > ARRIVALS_STALE_MS || update.timestamp * 1000 > now + 60_000)) continue;
      const stops = update.stopTimeUpdate;
      const index = stops.findIndex((stop) => (board.stops as readonly string[]).includes(stop.stopId ?? "") && servesStop(stop));
      if (index < 0) continue;
      // A short-turn or rerouted train is useful only if it still serves our destination.
      const destination = stops.slice(index + 1).find((stop) => stop.stopId === board.destinationStop && servesStop(stop));
      if (!destination) continue;
      const stop = stops[index];
      const at = (stop.arrival?.time ?? stop.departure?.time ?? 0) * 1000;
      if (at < now || at > now + 60 * 60_000) continue;
      const destinationAt = (destination.arrival?.time ?? destination.departure?.time ?? 0) * 1000;
      const id = `${update.trip.startDate ?? ""}:${update.trip.tripId}`;
      const candidate = { id, at: new Date(at).toISOString(), destinationAt: destinationAt >= at ? new Date(destinationAt).toISOString() : null, platform: stop.stopId === "R23S" ? "Broadway local platform" : stop.stopId === "Q01S" ? "Manhattan Bridge platform" : "" };
      const existing = arrivals.get(id);
      if (!existing || candidate.at < existing.at) arrivals.set(id, candidate);
    }
    return [{ boardId: board.id, route, status, feedAt, arrivals: [...arrivals.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 3) }];
  }));
}
