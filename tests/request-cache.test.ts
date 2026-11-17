import { describe, expect, it, vi } from "vitest";
import { RequestCache, untilAborted } from "../src/request-cache";

describe("RequestCache", () => {
  it("starts one request for everyone with the same key", async () => {
    const cache = new RequestCache<number>(1000);
    const load = vi.fn(async () => 7);
    const [first, second] = await Promise.all([cache.run("k", load), cache.run("k", load)]);
    expect([first, second]).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers from the cache without asking again", async () => {
    const cache = new RequestCache<number>(1000);
    const load = vi.fn(async () => 7);
    await cache.run("k", load, 1000);
    expect(cache.get("k", 1500)).toBe(7);
    expect(await cache.run("k", load, 1500)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("forgets an answer that is no longer fresh", async () => {
    const cache = new RequestCache<number>(1000);
    const load = vi.fn(async () => 7);
    await cache.run("k", load, 1000);
    expect(cache.get("k", 2001)).toBeUndefined();
    await cache.run("k", load, 2001);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("lets the next caller try again after a failure", async () => {
    const cache = new RequestCache<number>(1000);
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(cache.run("k", failing)).rejects.toThrow("offline");
    const load = vi.fn(async () => 7);
    expect(await cache.run("k", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a prefetch that nobody waits for from failing loudly", async () => {
    const cache = new RequestCache<number>(1000);
    cache.run("k", async () => {
      throw new Error("offline");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(cache.get("k")).toBeUndefined();
  });

  it("stops over 24 answers from piling up", async () => {
    const cache = new RequestCache<number>(60_000, 3);
    for (let index = 0; index < 5; index += 1) await cache.run(`k${index}`, async () => index);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k4")).toBe(4);
  });
});

describe("untilAborted", () => {
  it("rejects for the caller while the shared request keeps going", async () => {
    const cache = new RequestCache<number>(1000);
    const controller = new AbortController();
    let done = false;
    const task = cache.run("k", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      done = true;
      return 7;
    });
    const seen = untilAborted(task, controller.signal);
    controller.abort(new Error("abgebrochen"));
    await expect(seen).rejects.toThrow("abgebrochen");
    expect(await task).toBe(7);
    expect(done).toBe(true);
  });

  it("passes the answer through untouched without a signal", async () => {
    expect(await untilAborted(Promise.resolve(3))).toBe(3);
  });
});
