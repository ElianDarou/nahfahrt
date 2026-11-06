import { beforeEach, describe, expect, it } from "vitest";
import type { JourneysPayload } from "../convex/lib/journeys";
import { saveJourney } from "../src/saved";
import {
  LOCATION_STATION,
  getRoutes,
  getStations,
  loadJourneys,
  recordRoute,
  recordStationUse,
  renameStation,
  saveJourneys,
  toggleFavourite,
  type Station,
} from "../src/store";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} as Storage;

const stop: Station = { key: "s", name: "Hauptbahnhof", lat: 48, lon: 9, count: 0, last: 0 };
/** What a search holds in memory for a moment: the entry with real coordinates filled in. */
const located: Station = { ...LOCATION_STATION, lat: 48.123456, lon: 9.654321 };
const payload: JourneysPayload = {
  j: [{ u: 0, l: [{ m: "R", n: "RE7", f: "A", t: "B", a: 1000, b: 1020 }] }],
};

describe("the current position", () => {
  beforeEach(() => memory.clear());

  it("holds no coordinates in its search field entry", () => {
    expect([LOCATION_STATION.lat, LOCATION_STATION.lon]).toEqual([0, 0]);
  });

  it("stays out of the station list, however it is used", () => {
    recordStationUse(located);
    toggleFavourite(located);
    renameStation(located, "Hier");
    expect(getStations()).toEqual([]);
  });

  it("stays out of the routes and the result cache", () => {
    recordRoute(located, stop);
    recordRoute(stop, located);
    saveJourneys(located, stop, payload);
    expect(getRoutes()).toEqual([]);
    expect(loadJourneys(located, stop)).toBeUndefined();
  });

  it("never reaches storage, not even in a saved connection", () => {
    recordStationUse(located);
    recordRoute(located, stop);
    saveJourneys(located, stop, payload);
    saveJourney(located.name, stop.name, payload.j[0]);
    const stored = [...memory.values()].join();
    expect(stored).not.toContain("48.123");
    expect(stored).not.toContain("9.654");
  });

  it("does not disturb ordinary stations", () => {
    recordStationUse(stop);
    recordRoute(stop, { ...stop, key: "t" });
    expect(getStations()).toHaveLength(1);
    expect(getRoutes()).toHaveLength(1);
  });
});
