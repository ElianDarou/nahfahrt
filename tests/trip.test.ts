import { describe, expect, it } from "vitest";
import { mapTrip, type UpstreamTrip } from "../convex/lib/trip";

const at = (minute: number) => new Date(minute * 60000).toISOString();

const trip: UpstreamTrip = {
  legs: [
    {
      realTime: true,
      from: { name: "A", scheduledDeparture: at(100), departure: at(100) },
      to: { name: "D", scheduledArrival: at(130), arrival: at(135), track: "3" },
      intermediateStops: [
        {
          name: "B",
          scheduledArrival: at(110),
          arrival: at(112),
          scheduledDeparture: at(111),
          departure: at(113),
          track: "2",
          scheduledTrack: "1",
        },
        { name: "C", scheduledArrival: at(120), arrival: at(120), scheduledDeparture: at(121), departure: at(121) },
      ],
    },
  ],
};

describe("mapTrip", () => {
  it("cuts the trip to the travelled part", () => {
    const { s } = mapTrip(trip, 111, 120, false);
    expect(s.map((stop) => stop.n)).toEqual(["B", "C"]);
  });

  it("reports delays and platform changes", () => {
    const payload = mapTrip(trip, 100, 130, false);
    expect(payload.r).toBe(1);
    expect(payload.s[1]).toEqual({ n: "B", a: 110, d: 111, x: 2, y: 2, g: "2", p: 1 });
    expect(payload.s[3]).toEqual({ n: "D", a: 130, x: 5, g: "3" });
  });

  it("leaves names and scheduled times out of updates", () => {
    const { s } = mapTrip(trip, 100, 130, true);
    expect(s[0]).toEqual({});
    expect(s[3]).toEqual({ x: 5, g: "3" });
  });

  it("sends coordinates once, rounded, and not with updates", () => {
    const located: UpstreamTrip = {
      legs: [
        {
          from: { name: "A", scheduledDeparture: at(100), lat: 48.123456, lon: 9.654321 },
          to: { name: "B", scheduledArrival: at(110), lat: 48.2, lon: 9.7 },
        },
      ],
    };
    expect(mapTrip(located, 100, 110, false).s[0]).toMatchObject({ la: 48.1235, lo: 9.6543 });
    expect(mapTrip(located, 100, 110, true).s[0]).toEqual({});
  });

  it("keeps the whole trip when scheduled times no longer match", () => {
    expect(mapTrip(trip, 1, 2, false).s).toHaveLength(4);
  });

  it("handles a trip without data", () => {
    expect(mapTrip({}, 1, 2, false)).toEqual({ s: [] });
  });
});
