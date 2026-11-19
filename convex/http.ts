import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { parseFilters } from "./lib/filters";
import { cacheKey, cacheable } from "./lib/placeCache";
import type { Reservation } from "./quota";
import type { PlaceType } from "./lib/journeys";
import {
  UpstreamError,
  followTrip,
  planCallsFor,
  searchJourneys,
  searchNearby,
  searchPlaces,
  type Endpoint,
  type JourneySearch,
} from "./lib/transitous";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
    },
  });
}

const failure = (code: string, status: number) => json({ e: code }, status);

/**
 * The reservation is a database write and used to stand in front of every upstream call.
 * While the day's budget is clearly not close, both now run side by side, which takes that
 * round trip out of every search. The hint lives in this instance's memory: a fresh instance
 * knows nothing and asks first, and every answer brings the hint up to date. Near the limit,
 * it is back to asking first, so the upstream budget is never overrun by more than the few
 * requests already in flight.
 */
interface QuotaHint {
  day: string;
  left: number;
}
const hints: { plan?: QuotaHint; trip?: QuotaHint } = {};
const PLAN_MARGIN = 60;
const TRIP_MARGIN = 500;

const today = () => new Date().toISOString().slice(0, 10);

const roomFor = (hint: QuotaHint | undefined, margin: number): boolean =>
  !!hint && hint.day === today() && hint.left > margin;

/** Runs `work` once the reservation allows it, side by side with the reservation when there is room. */
async function withQuota<T>(
  kind: "plan" | "trip",
  margin: number,
  reserve: () => Promise<Reservation>,
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  if (roomFor(hints[kind], margin)) {
    const pending = work();
    // A failure of the work must not go unhandled while the reservation is still out.
    pending.catch(() => undefined);
    const reservation = await reserve();
    hints[kind] = { day: reservation.day, left: reservation.left };
    if (!reservation.ok) return { ok: false };
    return { ok: true, value: await pending };
  }
  const reservation = await reserve();
  hints[kind] = { day: reservation.day, left: reservation.left };
  if (!reservation.ok) return { ok: false };
  return { ok: true, value: await work() };
}

const COORDINATES = /^-?\d{1,2}(\.\d{1,7})?,-?\d{1,3}(\.\d{1,7})?$/;
const PLACE = /^[\p{L}\p{N} _:.,@|()+/-]{1,160}$/u;

function readEndpoint(params: URLSearchParams, name: "from" | "to"): Endpoint | null {
  const place = params.get(name);
  if (!place || !PLACE.test(place)) return null;
  const fallback = params.get(`${name}LL`) ?? undefined;
  if (fallback !== undefined && !COORDINATES.test(fallback)) return null;
  const type: PlaceType = params.get(`${name}Type`) === "addr" ? "addr" : "stop";
  return { place, fallback, type };
}

function readSearch(params: URLSearchParams): JourneySearch | null {
  const from = readEndpoint(params, "from");
  const to = readEndpoint(params, "to");
  const at = params.get("at");
  const cursor = params.get("cursor") ?? undefined;
  if (!from || !to || !at || Number.isNaN(Date.parse(at))) return null;
  if (cursor !== undefined && (cursor.length > 200 || !/^[\w|~-]*$/.test(cursor))) return null;
  const filters = parseFilters(params);
  if (!filters) return null;
  return { from, to, at, arriveBy: params.get("arrive") === "1", cursor, filters };
}

const http = httpRouter();

for (const path of ["/v1/places", "/v1/nearby", "/v1/journeys", "/v1/trip"]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
  });
}

http.route({
  path: "/v1/places",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const text = params.get("q")?.trim() ?? "";
    const near = params.get("near") ?? undefined;
    if (text.length < 2 || text.length > 80) return failure("bad_request", 400);
    if (near !== undefined && !COORDINATES.test(near)) return failure("bad_request", 400);
    const key = cacheKey(text, near);
    try {
      const known = await ctx.runQuery(internal.placeCache.lookup, { key });
      if (known) return json({ r: known }, 200, 86_400);
    } catch (error) {
      // The cache is only an accelerator; a broken read must not fail the search.
      console.error("place cache read failed", error);
    }
    try {
      const places = await searchPlaces(text, near);
      if (cacheable(places)) {
        try {
          await ctx.runMutation(internal.placeCache.store, { key, places });
        } catch (error) {
          console.error("place cache write failed", error);
        }
      }
      return json({ r: places }, 200, 86_400);
    } catch (error) {
      console.error("place search failed", error);
      return failure("upstream", 502);
    }
  }),
});

// A position stays out of every cache, so this response is never stored.
http.route({
  path: "/v1/nearby",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const position = new URL(request.url).searchParams.get("at") ?? "";
    if (!COORDINATES.test(position)) return failure("bad_request", 400);
    try {
      return json({ r: await searchNearby(position) }, 200);
    } catch {
      console.error("nearby search failed");
      return failure("upstream", 502);
    }
  }),
});

http.route({
  path: "/v1/journeys",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const search = readSearch(params);
    if (!search) return failure("bad_request", 400);
    // A search from the current position carries it in the URL, so nothing may cache it.
    const cacheSeconds = params.get("priv") === "1" ? 0 : 30;

    try {
      const result = await withQuota(
        "plan",
        PLAN_MARGIN,
        () => ctx.runMutation(internal.quota.reservePlanCalls, { calls: planCallsFor(search) }),
        () => searchJourneys(search),
      );
      if (!result.ok) return failure("daily_limit", 429);
      return json(result.value, 200, cacheSeconds);
    } catch (error) {
      console.error("journey search failed", error instanceof UpstreamError ? error.status : "network");
      const unknownPlace = error instanceof UpstreamError && error.status === 404;
      return failure(unknownPlace ? "unknown_place" : "upstream", unknownPlace ? 404 : 502);
    }
  }),
});

const TRIP_ID = /^[\w:.|+-]{1,200}$/;
const MINUTES = /^\d{1,10}$/;

http.route({
  path: "/v1/trip",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const id = params.get("id") ?? "";
    const boardAt = params.get("a") ?? "";
    const alightAt = params.get("b") ?? "";
    if (!TRIP_ID.test(id) || !MINUTES.test(boardAt) || !MINUTES.test(alightAt)) {
      return failure("bad_request", 400);
    }
    try {
      const update = params.get("u") === "1";
      const result = await withQuota(
        "trip",
        TRIP_MARGIN,
        () => ctx.runMutation(internal.quota.reserveTripCall, {}),
        () => followTrip(id, Number(boardAt), Number(alightAt), update),
      );
      if (!result.ok) return failure("daily_limit", 429);
      return json(result.value, 200, 20);
    } catch (error) {
      console.error("trip lookup failed", error);
      const unknown = error instanceof UpstreamError && error.status === 404;
      return failure(unknown ? "unknown_trip" : "upstream", unknown ? 404 : 502);
    }
  }),
});

export default http;
