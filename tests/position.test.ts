import { describe, expect, it } from "vitest";
import type { Journey } from "../convex/lib/journeys";
import type { TripStop } from "../convex/lib/trip";
import type { Fix } from "../src/location";
import {
  describePosition,
  distanceMetres,
  formatDistance,
  matchRoute,
  planned,
  scheduleText,
} from "../src/position";

const stops: TripStop[] = [
  { n: "A", d: 1000, la: 48.0, lo: 9.0 },
  { n: "B", a: 1010, d: 1011, la: 48.0, lo: 9.1 },
  { n: "C", a: 1020, la: 48.0, lo: 9.2 },
];

const journey: Journey = {
  u: 0,
  l: [
    { m: "W", d: 5 },
    { m: "R", n: "RE7", f: "A", t: "C", a: 1000, b: 1020, i: "trip" },
  ],
};

const at = (lat: number, lon: number, accuracy = 10): Fix => ({ lat, lon, accuracy, at: 0 });

describe("distanceMetres", () => {
  it("measures a kilometre", () => {
    expect(distanceMetres({ lat: 48, lon: 9 }, { lat: 48.009, lon: 9 })).toBeCloseTo(995, -1);
  });
});

describe("matchRoute", () => {
  it("places someone between two stops and compares with the schedule", () => {
    // Halfway from A to B is minute 1005, so at minute 1008 this is three behind.
    const match = matchRoute(stops, 0, at(48.0, 9.05), 1008)!;
    expect(match).toMatchObject({ stopsPassed: 1, atStop: false, onRoute: true, behindSchedule: 3 });
    expect(match.where).toBe("Zwischen A und B");
  });

  it("knows when someone is ahead of the schedule", () => {
    expect(matchRoute(stops, 0, at(48.0, 9.05), 1003)!.behindSchedule).toBe(-2);
  });

  it("recognises a stop, and counts no delay while the stop's time lasts", () => {
    const match = matchRoute(stops, 0, at(48.0003, 9.1), 1010)!;
    expect(match).toMatchObject({ stopsPassed: 2, atStop: true, behindSchedule: 0, where: "In B" });
  });

  it("tells a late departure from a stop", () => {
    expect(matchRoute(stops, 0, at(48.0, 9.1), 1015)!.behindSchedule).toBe(4);
  });

  it("notices someone far from the line", () => {
    const match = matchRoute(stops, 0, at(48.2, 9.05), 1005)!;
    expect(match.onRoute).toBe(false);
    expect(match.distance).toBeGreaterThan(20_000);
  });

  it("uses the clock when a line passes the same place twice", () => {
    const loop: TripStop[] = [
      { n: "A", d: 1000, la: 48.0, lo: 9.0 },
      { n: "B", a: 1010, d: 1010, la: 48.0, lo: 9.1 },
      { n: "C", a: 1020, d: 1020, la: 48.001, lo: 9.1 },
      { n: "D", a: 1030, la: 48.001, lo: 9.0 },
    ];
    expect(matchRoute(loop, 0, at(48.0005, 9.05), 1005)!.where).toBe("Zwischen A und B");
    expect(matchRoute(loop, 0, at(48.0005, 9.05), 1025)!.where).toBe("Zwischen C und D");
  });

  it("needs coordinates", () => {
    expect(matchRoute([{ n: "A" }, { n: "B" }], 0, at(48, 9), 1000)).toBeUndefined();
  });
});

describe("planned", () => {
  it("ignores delays", () => {
    const late: Journey = {
      ...journey,
      l: [journey.l[0], { m: "R", n: "RE7", f: "A", t: "C", a: 1000, b: 1020, x: 15, y: 15 }],
    };
    const lateStops = stops.map((stop) => ({ ...stop, x: 15, y: 15 }));
    const plan = planned(late, [lateStops], 1005);
    expect(plan.phase).toBe("riding");
    expect(plan.stopsPassed).toBe(1);
    expect(planned(late, [lateStops], 1030).phase).toBe("arrived");
  });
});

describe("describePosition", () => {
  it("measures the way to the stop before departure", () => {
    const position = describePosition(journey, [stops], at(48.0, 8.99), 990);
    expect(position).toMatchObject({ kind: "walk", stop: "A", atStop: false, minutesLeft: 10 });
    expect(position?.kind === "walk" && position.metres).toBeGreaterThan(700);
    expect(position?.kind === "walk" && position.walkMinutes).toBeGreaterThan(9);
  });

  it("sees that someone already waits at the stop", () => {
    expect(describePosition(journey, [stops], at(48.0, 9.0), 998)).toMatchObject({
      kind: "walk",
      atStop: true,
    });
  });

  it("compares the route with the plan while riding", () => {
    expect(describePosition(journey, [stops], at(48.0, 9.05), 1008)).toMatchObject({
      kind: "route",
      plan: "Zwischen A und B",
      match: { vehicle: 0, behindSchedule: 3 },
    });
  });

  it("says when someone is nowhere near the route", () => {
    expect(describePosition(journey, [stops], at(48.2, 9.05), 1005)).toMatchObject({ kind: "off" });
  });

  it("finds an earlier vehicle that runs late without live data", () => {
    const two: Journey = {
      u: 1,
      l: [
        { m: "B", n: "1", f: "A", t: "C", a: 1000, b: 1020 },
        { m: "R", n: "2", f: "C", t: "E", a: 1025, b: 1060 },
      ],
    };
    const second: TripStop[] = [
      { n: "C", d: 1025, la: 49, lo: 10 },
      { n: "E", a: 1060, la: 49, lo: 11 },
    ];
    expect(describePosition(two, [stops, second], at(48.0, 9.15), 1030)).toMatchObject({
      kind: "route",
      match: { vehicle: 0 },
    });
  });

  it("does not guess from a weak signal", () => {
    expect(describePosition(journey, [stops], at(48.0, 9.05, 2500), 1008)).toMatchObject({
      kind: "weak",
    });
  });

  it("has nothing to say after arrival or without coordinates", () => {
    expect(describePosition(journey, [stops], at(48, 9), 1100)).toBeNull();
    expect(describePosition(journey, [undefined], at(48, 9), 990)).toBeNull();
  });
});

describe("texts", () => {
  it("rounds distances for reading", () => {
    expect(formatDistance(83)).toBe("80 m");
    expect(formatDistance(2340)).toBe("2,3 km");
  });

  it("tolerates a minute either way", () => {
    expect(scheduleText(1)).toBe("Im Fahrplan");
    expect(scheduleText(4)).toBe("4 Min. hinter dem Fahrplan");
    expect(scheduleText(-3)).toBe("3 Min. vor dem Fahrplan");
  });
});
