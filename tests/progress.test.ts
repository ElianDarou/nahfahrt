import { describe, expect, it } from "vitest";
import type { Journey } from "../convex/lib/journeys";
import type { TripStop } from "../convex/lib/trip";
import { journeyEnd, journeyStart, progressOf } from "../src/progress";

const BASE = Math.round(Date.UTC(2026, 10, 9, 6) / 60000);
const at = (minute: number) => BASE + minute;

/** Walk 2, bus 0-20, walk 3, train 30-60, walk 1. */
const journey: Journey = {
  u: 1,
  l: [
    { m: "W", d: 2 },
    { m: "B", n: "12", h: "Bahnhof", f: "Dorf", t: "Bahnhof", a: at(0), b: at(20), g: "A" },
    { m: "W", d: 3 },
    { m: "R", n: "RE7", h: "Basel", f: "Bahnhof", t: "Stadt", a: at(30), b: at(60), g: "2", k: "5" },
    { m: "W", d: 1 },
  ],
};

const trainStops: TripStop[] = [
  { n: "Bahnhof", d: at(30) },
  { n: "Mitte", a: at(40), d: at(41) },
  { n: "Stadt", a: at(60) },
];

const progress = (minute: number, stops: (TripStop[] | undefined)[] = []) =>
  progressOf(journey, stops, at(minute));

describe("progressOf", () => {
  it("counts down before leaving, including the walk", () => {
    expect(journeyStart(journey)).toBe(at(-2));
    const state = progress(-32);
    expect(state.phase).toBe("upcoming");
    expect(state.headline).toBe("In 30 Min. losgehen");
    expect(state.detail).toBe("12 Richtung Bahnhof ab Dorf, Gleis A");
    expect(state.share).toBe(0);
  });

  it("shows a date for journeys further ahead", () => {
    const state = progress(-3 * 24 * 60);
    expect(state.phase).toBe("upcoming");
    expect(state.headline).toMatch(/9\. Nov/);
  });

  it("reports the walk to the first stop", () => {
    const state = progress(-1);
    expect(state.phase).toBe("approach");
    expect(state.headline).toBe("12 fährt in 1 Min.");
  });

  it("reports the alighting stop when stops are not loaded", () => {
    const state = progress(10);
    expect(state.phase).toBe("riding");
    expect(state.vehicle).toBe(0);
    expect(state.detail).toBe("Ausstieg Bahnhof in 10 Min.");
  });

  it("guides through a transfer", () => {
    const state = progress(25);
    expect(state.phase).toBe("transfer");
    expect(state.vehicle).toBe(1);
    expect(state.headline).toBe("Umstieg in Bahnhof");
    expect(state.detail).toBe("RE7 ab Bahnhof, Gleis 2, in 5 Min.");
  });

  it("names the next stop while riding", () => {
    const state = progress(35, [undefined, trainStops]);
    expect(state.phase).toBe("riding");
    expect(state.vehicle).toBe(1);
    expect(state.stopsPassed).toBe(1);
    expect(state.atStop).toBe(false);
    expect(state.detail).toBe("Nächster Halt Mitte in 5 Min. · Ausstieg Stadt in 25 Min.");
  });

  it("recognises a stop in progress", () => {
    const state = progress(40.5, [undefined, trainStops]);
    expect(state.phase).toBe("stopped");
    expect(state.headline).toBe("RE7 hält in Mitte");
    expect(state.stopsPassed).toBe(2);
    expect(state.atStop).toBe(true);
  });

  it("does not repeat the alighting stop as next stop", () => {
    const state = progress(50, [undefined, trainStops]);
    expect(state.detail).toBe("Ausstieg Stadt in 10 Min.");
  });

  it("follows delays", () => {
    const delayed: Journey = {
      ...journey,
      l: journey.l.map((leg) => (leg.m === "R" ? { ...leg, x: 10, y: 10 } : leg)),
    };
    expect(progressOf(delayed, [], at(35)).phase).toBe("transfer");
    expect(progressOf(delayed, [], at(65)).phase).toBe("riding");
    expect(journeyEnd(delayed)).toBe(at(71));
  });

  it("finishes with the last walk and arrival", () => {
    expect(progress(60.5).phase).toBe("final-walk");
    const state = progress(62);
    expect(state.phase).toBe("arrived");
    expect(state.share).toBe(1);
  });
});
