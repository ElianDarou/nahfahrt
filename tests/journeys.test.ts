import { describe, expect, it } from "vitest";
import {
  mergePlans,
  tidyName,
  type TransitLeg,
  type UpstreamItinerary,
  type UpstreamLeg,
} from "../convex/lib/journeys";

const minutes = (iso: string) => Date.parse(iso) / 60000;

function vehicle(line: string, start: string, end: string, extra: Partial<UpstreamLeg> = {}): UpstreamLeg {
  return {
    mode: "REGIONAL_RAIL",
    routeShortName: line,
    tripId: `${line}-${start}`,
    startTime: start,
    endTime: end,
    scheduledStartTime: start,
    scheduledEndTime: end,
    from: { name: "A", track: "1" },
    to: { name: "B", track: "2" },
    ...extra,
  };
}

const walk = (seconds: number): UpstreamLeg => ({
  mode: "WALK",
  duration: seconds,
  startTime: "2026-11-09T06:00:00Z",
  endTime: "2026-11-09T06:00:00Z",
  from: {},
  to: {},
});

function trip(legs: UpstreamLeg[]): UpstreamItinerary {
  const start = legs[0].startTime;
  const end = legs[legs.length - 1].endTime;
  return {
    legs,
    startTime: start,
    endTime: end,
    duration: (Date.parse(end) - Date.parse(start)) / 1000,
  };
}

describe("mergePlans", () => {
  it("keeps only what the app needs and reports delays relative to the schedule", () => {
    const payload = mergePlans([
      {
        itineraries: [
          trip([
            vehicle("RE7", "2026-11-09T07:05:00Z", "2026-11-09T07:47:00Z", {
              scheduledStartTime: "2026-11-09T07:00:00Z",
              scheduledEndTime: "2026-11-09T07:40:00Z",
              realTime: true,
              headsign: "Basel Bad Bf",
            }),
          ]),
        ],
      },
    ]);
    const leg = payload.j[0].l[0] as TransitLeg;
    expect(leg).toEqual({
      m: "R",
      n: "RE7",
      f: "A",
      t: "B",
      a: minutes("2026-11-09T07:00:00Z"),
      b: minutes("2026-11-09T07:40:00Z"),
      x: 5,
      y: 7,
      h: "Basel Bad Bf",
      g: "1",
      k: "2",
      r: 1,
    });
    expect(payload.j[0].u).toBe(0);
  });

  it("merges two searches without showing the same vehicles twice", () => {
    const shared = vehicle("S2", "2026-11-09T07:00:00Z", "2026-11-09T07:20:00Z");
    const payload = mergePlans([
      { itineraries: [trip([walk(120), shared])] },
      {
        itineraries: [
          trip([walk(1200), shared]),
          trip([vehicle("RB27", "2026-11-09T07:10:00Z", "2026-11-09T07:30:00Z")]),
        ],
      },
    ]);
    expect(payload.j).toHaveLength(2);
    expect((payload.j[0].l[1] as TransitLeg).n).toBe("S2");
    expect((payload.j[1].l[0] as TransitLeg).n).toBe("RB27");
  });

  it("removes results that wait hours for no gain", () => {
    const payload = mergePlans([
      {
        itineraries: [
          trip([vehicle("RB27", "2026-11-08T00:20:00Z", "2026-11-08T07:53:00Z")]),
          trip([vehicle("RB26", "2026-11-08T00:20:00Z", "2026-11-08T05:21:00Z")]),
        ],
      },
    ]);
    expect(payload.j).toHaveLength(1);
    expect((payload.j[0].l[0] as TransitLeg).n).toBe("RB26");
  });

  it("removes vehicles leaving before the requested time", () => {
    const payload = mergePlans(
      [
        {
          itineraries: [
            trip([vehicle("A", "2026-11-09T06:30:00Z", "2026-11-09T06:50:00Z")]),
            trip([vehicle("B", "2026-11-09T07:10:00Z", "2026-11-09T07:30:00Z")]),
          ],
        },
      ],
      { notBefore: minutes("2026-11-09T07:00:00Z") },
    );
    expect(payload.j).toHaveLength(1);
    expect((payload.j[0].l[0] as TransitLeg).n).toBe("B");
  });

  it("allows a walk to start shortly before the requested time, not long before", () => {
    const leaveAt = (start: string, walkMinutes: number): UpstreamItinerary => {
      const train = vehicle(start, start, "2026-11-09T08:00:00Z");
      const door = new Date(Date.parse(start) - walkMinutes * 60000).toISOString();
      return { ...trip([train]), startTime: door };
    };
    const payload = mergePlans(
      [
        {
          itineraries: [
            leaveAt("2026-11-09T06:07:00Z", 23),
            leaveAt("2026-11-09T06:19:00Z", 22),
          ],
        },
      ],
      { notBefore: minutes("2026-11-09T06:00:00Z") },
    );
    expect(payload.j).toHaveLength(1);
    expect((payload.j[0].l[0] as TransitLeg).n).toBe("2026-11-09T06:19:00Z");
  });

  it("combines paging cursors of both searches", () => {
    const payload = mergePlans([
      { nextPageCursor: "LATER|1", previousPageCursor: "EARLIER|1" },
      { nextPageCursor: "LATER|2", previousPageCursor: "EARLIER|2" },
    ]);
    expect(payload.n).toBe("LATER|1~LATER|2");
    expect(payload.p).toBe("EARLIER|1~EARLIER|2");
  });

  it("marks rail replacement services and cancellations", () => {
    const payload = mergePlans([
      {
        itineraries: [
          trip([
            vehicle("XEVS9", "2026-11-09T07:00:00Z", "2026-11-09T07:40:00Z", {
              mode: "BUS",
              cancelled: true,
            }),
          ]),
        ],
      },
    ]);
    const leg = payload.j[0].l[0] as TransitLeg;
    expect(leg.m).toBe("B");
    expect(leg.e).toBe(1);
    expect(leg.c).toBe(1);
  });

  it("offers walking when it is close enough", () => {
    const payload = mergePlans([
      { direct: [{ ...trip([walk(1380)]), duration: 1380 }], itineraries: [] },
    ]);
    expect(payload.w).toBe(23);
  });
});

describe("tidyName", () => {
  it("fixes names in capitals and leaves short abbreviations alone", () => {
    expect(tidyName("MANNHEIM HBF")).toBe("Mannheim Hbf");
    expect(tidyName("AACHEN Hauptbahnhof")).toBe("Aachen Hauptbahnhof");
    expect(tidyName("Freiburg ZOB")).toBe("Freiburg ZOB");
  });
});
