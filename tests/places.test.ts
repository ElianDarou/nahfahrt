import { describe, expect, it } from "vitest";
import { mapNearby, mapPlaces, type UpstreamMatch } from "../convex/lib/places";

const stop = (name: string, lat: number, lon: number, id: string, town?: string): UpstreamMatch => ({
  type: "STOP",
  name,
  id,
  lat,
  lon,
  country: "DE",
  areas: town ? [{ name: town, adminLevel: 8 }] : [],
});

describe("mapPlaces", () => {
  it("keeps only German places", () => {
    const places = mapPlaces([
      stop("Baden", 47.47, 8.3, "ch-1"),
      { ...stop("Baden", 47.47, 8.3, "ch-1"), country: "CH" },
    ]);
    expect(places).toHaveLength(1);
  });

  it("ranks stations above other stops of the same town", () => {
    const places = mapPlaces([
      stop("Musterstadt Post", 48.0924, 7.9574, "de-DELFI_a"),
      stop("Musterstadt Bahnhof", 48.0956, 7.9572, "de-DELFI_b"),
    ]);
    expect(places[0].n).toBe("Musterstadt Bahnhof");
  });

  it("ranks a main station above other stations", () => {
    const places = mapPlaces([
      stop("Mannheim, Käfertal, DB-Bahnhof", 49.51, 8.51, "de-DELFI_k"),
      stop("Mannheim Hbf", 49.47936, 8.46892, "de-DELFI_h"),
    ]);
    expect(places[0].n).toBe("Mannheim Hbf");
  });

  it("removes ride-sharing points next to a real stop", () => {
    const places = mapPlaces([
      stop("Musterstadt, Am Markt", 50.20002, 8.70002, "de-amarillo-bw_1"),
      stop("Am Markt", 50.2, 8.7, "de-DELFI_1"),
    ]);
    expect(places).toHaveLength(1);
    expect(places[0].i).toBe("de-DELFI_1");
  });

  it("routes remaining ride-sharing points by coordinates", () => {
    const [place] = mapPlaces([stop("Musterstadt, Bahnhof", 50.1, 8.6, "de-amarillo-bw_2")]);
    expect(place.i).toBeUndefined();
  });

  it("adds the town unless the name already contains it", () => {
    const [named, bare] = mapPlaces([
      stop("Freiburg Hauptbahnhof", 47.99682, 7.8414, "de-DELFI_f", "Freiburg"),
      stop("Hauptbahnhof", 48.78, 9.18, "de-DELFI_s", "Stuttgart"),
    ]);
    expect(named.s).toBeUndefined();
    expect(bare.s).toBe("Stuttgart");
  });

  it("marks addresses and never treats them as stops", () => {
    const [place] = mapPlaces([
      {
        type: "ADDRESS",
        name: "Musterstraße 1",
        lat: 50.1,
        lon: 8.6,
        country: "DE",
        areas: [{ name: "Musterstadt", adminLevel: 8 }],
      },
    ]);
    expect(place).toEqual({ n: "Musterstraße 1", s: "Musterstadt", y: 50.1, x: 8.6, a: 1 });
  });
});

describe("mapNearby", () => {
  it("leaves out ride-sharing points", () => {
    const places = mapNearby([
      stop("Stuttgart, Olgaeck", 48.77, 9.18, "de-amarillo-bw_1"),
      stop("Olgaeck", 48.771, 9.181, "de-DELFI_1"),
    ]);
    expect(places.map((place) => place.n)).toEqual(["Olgaeck"]);
  });
});
