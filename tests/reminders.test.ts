import { describe, expect, it } from "vitest";
import type { Journey } from "../convex/lib/journeys";
import { REMINDER_SLOTS, planReminders, reminderIds } from "../src/reminder-plan";
import { shareText } from "../src/share-text";

const journey: Journey = {
  u: 1,
  l: [
    { m: "W", d: 5 },
    { m: "B", n: "12", f: "A", t: "B", a: 1000, b: 1020, g: "3" },
    { m: "W", d: 3 },
    { m: "R", n: "RE7", h: "Ulm", f: "B", t: "C", a: 1030, b: 1060, g: "2", k: "5", y: 4 },
  ],
};

describe("planReminders", () => {
  it("reminds before leaving and before getting off", () => {
    const plan = planReminders({ journey }, 900);
    expect(plan.map((reminder) => reminder.at)).toEqual([985, 1018, 1062]);
    expect(plan[0].title).toBe("In 10 Min. losgehen");
    expect(plan[0].body).toContain("12 ab A, Gl. 3");
    expect(plan[1].title).toBe("Gleich aussteigen: B");
    expect(plan[1].body).toContain("Weiter mit RE7 ab B, Gl. 2");
    expect(plan[2].title).toBe("Gleich aussteigen: C");
    expect(plan[2].body).toContain("Gl. 5");
  });

  it("names the vehicle when no walk comes first", () => {
    const direct: Journey = { u: 0, l: [{ m: "R", n: "RE7", f: "A", t: "B", a: 1000, b: 1020 }] };
    expect(planReminders({ journey: direct }, 900)[0].title).toBe("RE7 fährt in 10 Min.");
  });

  it("drops what is past", () => {
    expect(planReminders({ journey }, 1000).map((reminder) => reminder.at)).toEqual([1018, 1062]);
    expect(planReminders({ journey }, 2000)).toEqual([]);
  });

  it("skips getting off when the ride is too short for it", () => {
    const hop: Journey = { u: 0, l: [{ m: "B", n: "1", f: "A", t: "B", a: 1000, b: 1002 }] };
    expect(planReminders({ journey: hop }, 900)).toHaveLength(1);
  });

  it("moves with delays", () => {
    const late: Journey = {
      u: 0,
      l: [{ m: "R", n: "RE7", f: "A", t: "B", a: 1000, b: 1020, x: 10, y: 10 }],
    };
    expect(planReminders({ journey: late }, 900).map((reminder) => reminder.at)).toEqual([1000, 1028]);
  });
});

describe("reminderIds", () => {
  it("is stable, distinct and fits an Android id", () => {
    const ids = reminderIds("RE7@1000>S1@1040");
    expect(ids).toEqual(reminderIds("RE7@1000>S1@1040"));
    expect(new Set(ids).size).toBe(REMINDER_SLOTS);
    expect(Math.max(...ids)).toBeLessThan(2 ** 31);
    expect(Math.min(...ids)).toBeGreaterThan(0);
    expect(ids).not.toEqual(reminderIds("RE7@1001>S1@1040"));
  });
});

describe("shareText", () => {
  it("writes the connection out", () => {
    const text = shareText("Zuhause", "Arbeit", journey);
    const lines = text.split("\n");
    expect(lines[0]).toBe("Zuhause → Arbeit");
    expect(lines[1]).toContain("1 Umstieg");
    expect(text).toContain("RE7 Richtung Ulm ab B, Gl. 2");
    expect(text).toContain("(+4) an C, Gl. 5");
    expect(text).toContain("Zu Fuß 3 Min.");
  });

  it("marks what is cancelled", () => {
    const cancelled: Journey = { u: 0, l: [{ m: "R", n: "RE7", f: "A", t: "B", a: 1, b: 2, c: 1 }] };
    expect(shareText("A", "B", cancelled)).toContain("Fällt aus");
  });
});
