import type { TrainRoute } from "./transit";

export const ARRIVALS_STALE_MS = 120_000;
// Directional platform IDs verified against MTA stops.txt on November 1, 2026.
// Canal's N normally uses the bridge platform; also handle a rerouted local N.
export const ARRIVAL_BOARDS = [
  { id: "canal", station: "Canal Street", direction: "Brooklyn-bound N", destination: "36th Street", stops: ["Q01S", "R23S"], destinationStop: "R36S", routes: ["N"] },
  { id: "36th", station: "36th Street · Brooklyn", direction: "Manhattan-bound N or D", destination: "Atlantic–Barclays", stops: ["R36N"], destinationStop: "R31N", routes: ["N", "D"] },
  { id: "atlantic", station: "Atlantic–Barclays", direction: "Uptown Q toward 96th Street", destination: "96th Street", stops: ["D24N"], destinationStop: "Q05N", routes: ["Q"] },
] as const;
export type BoardId = typeof ARRIVAL_BOARDS[number]["id"];
export type TrainArrival = { id: string; at: string; destinationAt: string | null; platform: string };
export type ArrivalService = {
  boardId: BoardId; route: TrainRoute; feedAt: string | null;
  status: "fresh" | "stale" | "unavailable"; arrivals: TrainArrival[];
};
export type ArrivalsSnapshot = { checkedAt: string; services: ArrivalService[] };

export function arrivalStatus(service: ArrivalService, now: number): ArrivalService["status"] {
  if (service.status !== "fresh") return service.status;
  const timestamp = Date.parse(service.feedAt ?? "");
  return !Number.isFinite(timestamp) || now - timestamp > ARRIVALS_STALE_MS || timestamp > now + 60_000 ? "stale" : "fresh";
}

export function arrivalCountdown(at: string, now: number): string | null {
  const remaining = Date.parse(at) - now;
  if (!Number.isFinite(remaining) || remaining < 0) return null;
  return remaining < 60_000 ? "<1 min" : `${Math.ceil(remaining / 60_000)} min`;
}
