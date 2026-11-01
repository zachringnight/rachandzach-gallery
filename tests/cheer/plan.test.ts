import { describe, expect, it } from "vitest";
import { STOPS, finishMinutes, itineraryText, mapLinks, nyTime, paceLabel, sightingTime, validStart } from "@/lib/cheer/plan";

describe("race-day estimates", () => {
  it("calculates the 3:25 plan in New York time, after the DST change", () => {
    expect(STOPS.map((stop) => nyTime(sightingTime("09:10", 205, stop.mile)))).toEqual(["9:52 AM", "11:31 AM", "12:12 PM"]);
    expect(paceLabel(205)).toBe("7:49");
    expect(new Date(sightingTime("09:10", 205, 0)).toISOString()).toBe("2026-11-01T14:10:00.000Z");
  });
  it("shifts every sighting when the start crossing changes", () => {
    for (const stop of STOPS) expect(sightingTime("09:20", 205, stop.mile) - sightingTime("09:10", 205, stop.mile)).toBe(600_000);
  });
  it("validates inputs without silently converting missing or invalid values", () => {
    expect(finishMinutes("3:25")).toBe(205);
    expect(finishMinutes("8:00")).toBe(480);
    for (const invalid of ["", "0:00", "3:99", "3:5", "8:01", "NaN", "3:25abc"]) expect(finishMinutes(invalid)).toBeNull();
    expect(validStart("09:10")).toBe(true);
    expect(validStart("25:00")).toBe(false);
  });
  it("pins the intended borough and keeps private meetup details out of sharing", () => {
    expect(decodeURIComponent(mapLinks(STOPS[0]).google)).toContain("Fourth Avenue & 36th Street, Brooklyn, New York, NY");
    expect(decodeURIComponent(mapLinks(STOPS[2]).apple)).toContain("Fifth Avenue & East 96th Street, Manhattan");
    const shared = itineraryText("09:10", 205);
    expect(shared).toContain("0.6–0.7 mile");
    expect(shared).toContain("12:35 PM");
    expect(shared).toContain("LEFT");
    expect(shared).not.toMatch(/Howard|lobby|8:10/);
  });
});
