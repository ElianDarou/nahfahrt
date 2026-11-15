import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../convex/lib/places";

const memory = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} as Storage;

const hbf: Place = { n: "Stuttgart Hbf", y: 48.78, x: 9.18, i: "de:1" };
const street: Place = { n: "Musterstraße 1", s: "Stuttgart", y: 48.7, x: 9.1, a: 1 };

// The cache keeps a copy in memory, so each test loads the module fresh.
async function fresh() {
  vi.resetModules();
  return import("../src/store");
}

describe("cached place searches", () => {
  beforeEach(() => memory.clear());

  it("answers a repeated stop search from the device, also after a restart", async () => {
    (await fresh()).storePlaces("Stuttgart", [hbf]);
    const restarted = await fresh();
    expect(restarted.cachedPlaces(" stuttgart ")).toEqual([hbf]);
  });

  it("keeps address searches for the session only", async () => {
    const store = await fresh();
    store.storePlaces("Musterstraße 1", [street]);
    expect(store.cachedPlaces("Musterstraße 1")).toEqual([street]);
    expect(memory.get("nf.places.v1") ?? "").not.toContain("Musterstraße");
    expect((await fresh()).cachedPlaces("Musterstraße 1")).toBeUndefined();
  });

  it("offers the longest earlier search the text starts with", async () => {
    const store = await fresh();
    store.storePlaces("St", [street]);
    store.storePlaces("Stutt", [hbf]);
    expect(store.cachedPlacesForPrefix("Stuttgart")).toEqual([hbf]);
    expect(store.cachedPlacesForPrefix("Berlin")).toBeUndefined();
  });

  it("forgets answers after a month", async () => {
    const now = Date.now();
    memory.set("nf.places.v1", JSON.stringify([{ q: "ulm", t: now - 31 * 86_400_000, r: [hbf] }]));
    expect((await fresh()).cachedPlaces("Ulm")).toBeUndefined();
  });

  it("keeps at most 80 searches on the device", async () => {
    const store = await fresh();
    for (let i = 0; i < 90; i++) store.storePlaces(`Ort ${String.fromCharCode(97 + (i % 26))}${i}x`.replace(/\d/g, ""), [hbf]);
    const saved = JSON.parse(memory.get("nf.places.v1") ?? "[]") as unknown[];
    expect(saved.length).toBeLessThanOrEqual(80);
  });
});
