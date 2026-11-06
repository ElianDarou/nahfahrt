import { describe, expect, it } from "vitest";
import type { Journey, TransitLeg } from "../convex/lib/journeys";
import { activeFilterCount, defaultFilters, filterProblem, filtersToQuery } from "../src/filters";
import { applyTrip, isExpired, vehiclesToFollow, type SavedJourney } from "../src/saved";

const journey: Journey = {
  u: 1,
  l: [
    { m: "B", n: "12", i: "bus", f: "A", t: "B", a: 1000, b: 1020 },
    { m: "W", d: 3 },
    { m: "R", n: "RE7", i: "train", f: "B", t: "C", a: 1030, b: 1060 },
    { m: "W", d: 5 },
  ],
};

const entry: SavedJourney = { key: "k", from: "A", to: "C", journey, stops: [undefined, undefined] };

describe("isExpired", () => {
  it("keeps a journey until a while after its arrival", () => {
    expect(isExpired(entry, 1060)).toBe(false);
    expect(isExpired(entry, 1080)).toBe(false);
    expect(isExpired(entry, 1081)).toBe(true);
  });

  it("follows the delayed arrival", () => {
    const delayed = {
      journey: {
        ...journey,
        l: journey.l.map((leg) => (leg.m === "R" ? { ...leg, y: 30 } : leg)),
      },
    };
    expect(isExpired(delayed, 1081)).toBe(false);
  });
});

describe("applyTrip", () => {
  it("takes delays and platforms from the first and last stop", () => {
    const updated = applyTrip(
      entry,
      1,
      {
        r: 1,
        s: [
          { n: "B", d: 1030, y: 4, g: "2" },
          { n: "C", a: 1060, x: 6, g: "5" },
        ],
      },
      false,
    )!;
    const train = updated.journey.l[2] as TransitLeg;
    expect(train).toMatchObject({ x: 4, y: 6, g: "2", k: "5", r: 1 });
    expect(updated.journey.l[0]).toEqual(journey.l[0]);
    expect(updated.stops[1]).toHaveLength(2);
    expect(updated.updatedAt).toBeDefined();
  });

  it("merges updates into the known stop list and clears old delays", () => {
    const loaded = applyTrip(
      entry,
      1,
      { s: [{ n: "B", d: 1030, y: 4 }, { n: "C", a: 1060 }] },
      false,
    )!;
    const updated = applyTrip(loaded, 1, { r: 1, s: [{}, { x: 2 }] }, true)!;
    expect(updated.stops[1]).toEqual([
      { n: "B", a: undefined, d: 1030 },
      { n: "C", a: 1060, d: undefined, x: 2 },
    ]);
    expect((updated.journey.l[2] as TransitLeg).x).toBeUndefined();
  });

  it("asks for a new stop list when an update does not fit", () => {
    const loaded = applyTrip(entry, 1, { s: [{ n: "B" }, { n: "C" }] }, false)!;
    expect(applyTrip(loaded, 1, { s: [{}, {}, {}] }, true)).toBeNull();
    expect(applyTrip(entry, 1, { s: [{}, {}] }, true)).toBeNull();
  });
});

describe("vehiclesToFollow", () => {
  it("asks only about vehicles in use or coming up", () => {
    expect(vehiclesToFollow(journey, 800)).toEqual([]);
    expect(vehiclesToFollow(journey, 915)).toEqual([0]);
    expect(vehiclesToFollow(journey, 950)).toEqual([0, 1]);
    expect(vehiclesToFollow(journey, 1040)).toEqual([1]);
    expect(vehiclesToFollow(journey, 1070)).toEqual([]);
  });
});

describe("filters", () => {
  it("sends nothing and counts nothing by default", () => {
    const filters = defaultFilters();
    expect(filtersToQuery(filters)).toEqual({});
    expect(activeFilterCount(filters)).toBe(0);
    expect(filterProblem(filters)).toBeUndefined();
  });

  it("counts and sends chosen filters", () => {
    const filters = { ...defaultFilters(), sort: "fast" as const, maxTransfers: "0", modes: "BS" };
    expect(activeFilterCount(filters)).toBe(3);
    expect(filtersToQuery(filters)).toEqual({ sort: "fast", mt: "0", md: "BS" });
  });

  it("treats a window past midnight as the following night", () => {
    const query = filtersToQuery({
      ...defaultFilters(),
      date: "2026-11-09",
      departFrom: "22:00",
      departTo: "01:00",
    });
    expect(Number(query.dt) - Number(query.df)).toBe(180);
  });

  it("explains incomplete input", () => {
    expect(filterProblem({ ...defaultFilters(), departFrom: "08:00" })).toMatch(/Abfahrt/);
    expect(filterProblem({ ...defaultFilters(), modes: "" })).toMatch(/Verkehrsmittel/);
  });

  it("skips a via stop without stop id", () => {
    const via = { key: "x", name: "Adresse", lat: 1, lon: 1, count: 0, last: 0 };
    expect(filtersToQuery({ ...defaultFilters(), via }).via).toBeUndefined();
  });
});
