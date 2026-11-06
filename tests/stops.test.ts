import { describe, expect, it } from "vitest";
import type { Place } from "../convex/lib/places";
import { pickStop } from "../src/stops";

const place = (n: string, y: number, x: number): Place => ({ n, y, x });

describe("pickStop", () => {
  it("prefers the stop of that name over a closer one", () => {
    const places = [place("Rathaus", 48.0001, 9), place("Marktplatz", 48.001, 9)];
    expect(pickStop(places, "Marktplatz", 48, 9)?.n).toBe("Marktplatz");
  });

  it("accepts a name with the town in front", () => {
    expect(pickStop([place("Stuttgart Hauptbahnhof", 48, 9)], "Hauptbahnhof", 48, 9)?.n).toBe(
      "Stuttgart Hauptbahnhof",
    );
  });

  it("does not take a namesake from far away", () => {
    expect(pickStop([place("Marktplatz", 49, 9)], "Marktplatz", 48, 9)).toBeUndefined();
  });

  it("takes whatever stands right there when the name differs", () => {
    expect(pickStop([place("Bf Nord", 48.0001, 9)], "Nordbahnhof", 48, 9)?.n).toBe("Bf Nord");
    expect(pickStop([place("Bf Nord", 48.01, 9)], "Nordbahnhof", 48, 9)).toBeUndefined();
  });
});
