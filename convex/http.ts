import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { PlaceType } from "./lib/journeys";
import {
  UpstreamError,
  planCallsFor,
  searchJourneys,
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
  return { from, to, at, arriveBy: params.get("arrive") === "1", cursor };
}

const http = httpRouter();

for (const path of ["/v1/places", "/v1/journeys"]) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async () => new Response(null, { status: 204, headers: CORS_HEADERS })),
  });
}

http.route({
  path: "/v1/places",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const params = new URL(request.url).searchParams;
    const text = params.get("q")?.trim() ?? "";
    const near = params.get("near") ?? undefined;
    if (text.length < 2 || text.length > 80) return failure("bad_request", 400);
    if (near !== undefined && !COORDINATES.test(near)) return failure("bad_request", 400);
    try {
      return json({ r: await searchPlaces(text, near) }, 200, 86_400);
    } catch (error) {
      console.error("place search failed", error);
      return failure("upstream", 502);
    }
  }),
});

http.route({
  path: "/v1/journeys",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const search = readSearch(new URL(request.url).searchParams);
    if (!search) return failure("bad_request", 400);

    const allowed = await ctx.runMutation(internal.quota.reservePlanCalls, {
      calls: planCallsFor(search),
    });
    if (!allowed) return failure("daily_limit", 429);

    try {
      return json(await searchJourneys(search), 200, 30);
    } catch (error) {
      console.error("journey search failed", error);
      const unknownPlace = error instanceof UpstreamError && error.status === 404;
      return failure(unknownPlace ? "unknown_place" : "upstream", unknownPlace ? 404 : 502);
    }
  }),
});

export default http;
