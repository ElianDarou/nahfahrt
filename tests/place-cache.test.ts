import { describe, expect, it } from "vitest";
import { cacheKey, cacheable, normalizeQuery } from "../convex/lib/placeCache";
import type { Place } from "../convex/lib/places";

const stop: Place = { n: "Stuttgart Hbf", y: 48.78, x: 9.18, i: "de:1" };
const address: Place = { n: "Musterstraße 1", s: "Stuttgart", y: 48.7, x: 9.1, a: 1 };

describe("place cache keys", () => {
  it("files the same search under the same key, whatever the spacing or case", () => {
    expect(cacheKey("  Stuttgart   HBF ")).toBe("stuttgart hbf");
    expect(normalizeQuery("Stuttgart Hbf")).toBe("stuttgart hbf");
  });

  it("keeps regions apart, because the bias changes the answer", () => {
    expect(cacheKey("Hauptbahnhof", "48.78,9.18")).not.toBe(
      cacheKey("Hauptbahnhof", "52.52,13.40"),
    );
    expect(cacheKey("Hauptbahnhof", "48.78,9.18")).toBe("hauptbahnhof|48.78,9.18");
  });
});

describe("what may be cached", () => {
  it("keeps pure stop lists", () => {
    expect(cacheable([stop, { ...stop, n: "Stuttgart Stadtmitte" }])).toBe(true);
  });

  it("never keeps an answer that contains an address", () => {
    expect(cacheable([stop, address])).toBe(false);
  });

  it("does not keep empty answers", () => {
    expect(cacheable([])).toBe(false);
  });
});
