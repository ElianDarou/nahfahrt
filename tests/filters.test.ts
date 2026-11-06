import { describe, expect, it } from "vitest";
import { hasWindow, parseFilters, upstreamModes } from "../convex/lib/filters";

const parse = (query: string) => parseFilters(new URLSearchParams(query));

describe("parseFilters", () => {
  it("is empty without filters", () => {
    expect(parse("")).toEqual({});
  });

  it("reads all filters", () => {
    expect(parse("sort=fast&mt=1&md=BS&wk=10&xt=5&tv=120&sf=1&via=de-DELFI_a:1&vs=30")).toEqual({
      sort: "fast",
      maxTransfers: 1,
      modes: "BS",
      maxWalk: 10,
      extraTransfer: 5,
      maxTravel: 120,
      stepFree: true,
      via: "de-DELFI_a:1",
      viaStay: 30,
    });
  });

  it.each(["sort=slow", "mt=99", "mt=abc", "md=X", "wk=0", "wk=300", "via=%3Cscript%3E"])(
    "rejects %s",
    (query) => {
      expect(parse(query)).toBeNull();
    },
  );

  it("requires both ends of a window, in order and of sensible length", () => {
    expect(parse("df=100")).toBeNull();
    expect(parse("df=200&dt=100")).toBeNull();
    expect(parse("af=100&al=99999")).toBeNull();
    const filters = parse("df=100&dt=160");
    expect(filters).toEqual({ departFrom: 100, departTo: 160 });
    expect(hasWindow(filters!)).toBe(true);
  });
});

describe("upstreamModes", () => {
  it("expands regional trains to both upstream types", () => {
    expect(upstreamModes("BR")).toBe("BUS,REGIONAL_RAIL,REGIONAL_FAST_RAIL");
  });
});
