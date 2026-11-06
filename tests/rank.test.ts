import { describe, expect, it } from "vitest";
import { byUsage, matches, normalize, usageScore, type Rankable } from "../src/rank";

const station = (name: string, extra: Partial<Rankable> = {}): Rankable => ({
  name,
  count: 1,
  last: Date.now(),
  ...extra,
});

describe("matches", () => {
  it("finds a station from the first letters", () => {
    expect(matches("frei", station("Freiburg Hauptbahnhof"))).toBe(true);
    expect(matches("krozi", station("Bad Krozingen"))).toBe(true);
    expect(matches("mann", station("Freiburg Hauptbahnhof"))).toBe(false);
  });

  it("treats Hbf and Hauptbahnhof as the same word", () => {
    expect(matches("freiburg hbf", station("Freiburg Hauptbahnhof"))).toBe(true);
    expect(matches("mannheim hauptbahnhof", station("Mannheim Hbf"))).toBe(true);
  });

  it("ignores umlauts and punctuation", () => {
    expect(normalize("Grüner-Hof, Musterstadt")).toBe("gruner hof musterstadt");
    expect(matches("gruner", station("Gasthaus Grüner Hof"))).toBe(true);
    expect(matches("st annen", station("St.Annenbrücke"))).toBe(true);
  });

  it("finds a favourite by its own name and by its town", () => {
    expect(matches("sport", station("Musterstadt Bahnhof", { label: "Sportverein" }))).toBe(true);
    expect(matches("muster", station("Musterstraße 1", { sub: "Musterstadt" }))).toBe(true);
  });

  it("requires every typed word", () => {
    expect(matches("freiburg mannheim", station("Freiburg Hauptbahnhof"))).toBe(false);
  });
});

describe("byUsage", () => {
  const now = Date.UTC(2026, 10, 6);
  const day = 86_400_000;

  it("sorts frequently used stations first", () => {
    const sorted = byUsage(
      [station("Selten", { count: 1, last: now }), station("Oft", { count: 5, last: now })],
      now,
    );
    expect(sorted[0].name).toBe("Oft");
  });

  it("puts favourites above everything else", () => {
    const sorted = byUsage(
      [station("Oft", { count: 50, last: now }), station("Favorit", { fav: true, count: 0, last: 0 })],
      now,
    );
    expect(sorted[0].name).toBe("Favorit");
  });

  it("lets old habits fade", () => {
    expect(usageScore({ count: 8, last: now - 45 * day }, now)).toBeCloseTo(4);
    const sorted = byUsage(
      [
        station("Früher oft", { count: 10, last: now - 365 * day }),
        station("Aktuell", { count: 2, last: now - day }),
      ],
      now,
    );
    expect(sorted[0].name).toBe("Aktuell");
  });
});
