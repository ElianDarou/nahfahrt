import { describe, expect, it } from "vitest";
import type { Journey } from "../convex/lib/journeys";
import { formatDuration, totalMinutes, transferRisk, transfers } from "../src/format";

const journey: Journey = {
  u: 1,
  l: [
    { m: "W", d: 2 },
    { m: "B", n: "12", f: "A", t: "B", a: 100, b: 120 },
    { m: "W", d: 3 },
    { m: "R", n: "RE7", f: "B", t: "C", a: 129, b: 145 },
    { m: "W", d: 1 },
  ],
};

describe("journey helpers", () => {
  it("counts walks at both ends in the total time", () => {
    expect(totalMinutes(journey)).toBe(48);
  });

  it("calculates transfer time and walk", () => {
    expect(transfers(journey)).toEqual([{ minutes: 9, walk: 3 }]);
    expect(transferRisk(journey)).toBeUndefined();
  });

  it("flags tight transfers and those broken by a delay", () => {
    const tight: Journey = {
      u: 1,
      l: [
        { m: "B", n: "1", f: "A", t: "B", a: 100, b: 120 },
        { m: "R", n: "2", f: "B", t: "C", a: 123, b: 140 },
      ],
    };
    expect(transferRisk(tight)).toBe("tight");
    const broken: Journey = {
      u: 1,
      l: [
        { m: "B", n: "1", f: "A", t: "B", a: 100, b: 120, y: 6 },
        { m: "W", d: 2 },
        { m: "R", n: "2", f: "B", t: "C", a: 123, b: 140 },
      ],
    };
    expect(transferRisk(broken)).toBe("broken");
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45 Min.");
    expect(formatDuration(60)).toBe("1 Std.");
    expect(formatDuration(85)).toBe("1 Std. 25 Min.");
  });
});
