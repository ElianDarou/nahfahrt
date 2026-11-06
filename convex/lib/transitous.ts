import {
  ACCEPTED_MODES,
  LONG_WALK_SECONDS,
  MIN_TRANSFER_MINUTES,
  SHORT_WALK_SECONDS,
  mergePlans,
  type JourneysPayload,
  type PlaceType,
  type UpstreamPlan,
} from "./journeys";
import { mapPlaces, type Place, type UpstreamMatch } from "./places";

const BASE_URL = "https://api.transitous.org/api";
// Transitous asks every client to identify itself and name a way of contact.
const USER_AGENT = "Nahfahrt/0.1 (+https://github.com/ElianDarou/nahfahrt)";
const TIMEOUT_MS = 12_000;
/** Germany's rough centre, used when the app has no better location hint. */
const GERMANY_CENTRE = "51.1,10.4";

export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Transitous responded with ${status}`);
  }
}

async function getJson<T>(path: string, query: Record<string, string>): Promise<T> {
  const url = `${BASE_URL}${path}?${new URLSearchParams(query)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new UpstreamError(response.status);
  return (await response.json()) as T;
}

export interface Endpoint {
  /** Stop id, or "lat,lon". */
  place: string;
  /** Coordinates used when the stop id is no longer known upstream. */
  fallback?: string;
  type: PlaceType;
}

export interface JourneySearch {
  from: Endpoint;
  to: Endpoint;
  /** Requested time as ISO string. */
  at: string;
  arriveBy: boolean;
  /** Composite paging cursor returned by an earlier search. */
  cursor?: string;
}

interface PlanVariant {
  preWalk: number;
  postWalk: number;
  /** Shifts the upstream search time so a walk may start before the requested time. */
  shiftSeconds: number;
}

/**
 * Addresses get two searches: short walks keep nearby buses in the results, long
 * walks add options such as walking to a station instead of taking a feeder bus.
 */
function variantsFor(search: JourneySearch): PlanVariant[] {
  const fromAddress = search.from.type === "addr";
  const toAddress = search.to.type === "addr";
  const short: PlanVariant = {
    preWalk: SHORT_WALK_SECONDS,
    postWalk: SHORT_WALK_SECONDS,
    shiftSeconds: 0,
  };
  if (!fromAddress && !toAddress) return [short];

  // The app's requested time refers to the first vehicle, not to leaving the door.
  const relevantWalk = search.arriveBy ? toAddress : fromAddress;
  const direction = search.arriveBy ? 1 : -1;
  return [
    { ...short, shiftSeconds: relevantWalk ? direction * SHORT_WALK_SECONDS : 0 },
    {
      preWalk: fromAddress ? LONG_WALK_SECONDS : SHORT_WALK_SECONDS,
      postWalk: toAddress ? LONG_WALK_SECONDS : SHORT_WALK_SECONDS,
      shiftSeconds: relevantWalk ? direction * LONG_WALK_SECONDS : 0,
    },
  ];
}

/** Upstream `/plan` calls one search will make, for the daily budget. */
export const planCallsFor = (search: JourneySearch): number => variantsFor(search).length;

async function plan(
  search: JourneySearch,
  variant: PlanVariant,
  cursor: string | undefined,
  from: string,
  to: string,
): Promise<UpstreamPlan> {
  const time = new Date(Date.parse(search.at) + variant.shiftSeconds * 1000).toISOString();
  const query: Record<string, string> = {
    fromPlace: from,
    toPlace: to,
    time,
    transitModes: ACCEPTED_MODES,
    minTransferTime: String(MIN_TRANSFER_MINUTES),
    maxPreTransitTime: String(variant.preWalk),
    maxPostTransitTime: String(variant.postWalk),
    language: "de",
  };
  if (search.arriveBy) query.arriveBy = "true";
  if (variant.shiftSeconds !== 0 && !cursor) query.numItineraries = "8";
  if (cursor) query.pageCursor = cursor;
  return getJson<UpstreamPlan>("/v5/plan", query);
}

async function planWithFallback(
  search: JourneySearch,
  variant: PlanVariant,
  cursor: string | undefined,
): Promise<UpstreamPlan> {
  try {
    return await plan(search, variant, cursor, search.from.place, search.to.place);
  } catch (error) {
    const canRetry =
      error instanceof UpstreamError &&
      error.status === 404 &&
      (search.from.fallback !== undefined || search.to.fallback !== undefined);
    if (!canRetry) throw error;
    return plan(
      search,
      variant,
      cursor,
      search.from.fallback ?? search.from.place,
      search.to.fallback ?? search.to.place,
    );
  }
}

export async function searchJourneys(search: JourneySearch): Promise<JourneysPayload> {
  const variants = variantsFor(search);
  const cursors = search.cursor?.split("~") ?? [];
  const settled = await Promise.allSettled(
    variants.map((variant, index) => {
      const cursor = cursors[index];
      // This variant's results ended on an earlier page.
      if (search.cursor && !cursor) return Promise.resolve<UpstreamPlan>({});
      return planWithFallback(search, variant, cursor);
    }),
  );

  const plans = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (!plans.length) throw (settled[0] as PromiseRejectedResult).reason;

  const requested = Math.round(Date.parse(search.at) / 60000);
  return mergePlans(
    plans,
    search.cursor
      ? {}
      : search.arriveBy
        ? { notAfter: requested }
        : { notBefore: requested },
  );
}

/** Searches stops and, when useful, addresses. */
export async function searchPlaces(text: string, near?: string): Promise<Place[]> {
  const base = {
    text,
    language: "de",
    place: near ?? GERMANY_CENTRE,
    placeBias: near ? "10" : "5",
  };
  const search = (type: string) =>
    getJson<UpstreamMatch[]>("/v1/geocode", { ...base, type });

  if (/\d/.test(text)) {
    const [addresses, stops] = await Promise.all([search("ADDRESS"), search("STOP")]);
    return mapPlaces([...addresses, ...stops]);
  }
  // A bare town name rarely ranks its station first, so ask for that as well.
  const asksForStation = /bahnhof|hbf/i.test(text);
  const [stations, general] = await Promise.all([
    asksForStation
      ? Promise.resolve<UpstreamMatch[]>([])
      : getJson<UpstreamMatch[]>("/v1/geocode", { ...base, text: `${text} Hauptbahnhof`, type: "STOP" }),
    search("STOP"),
  ]);
  const prefix = text.toLocaleLowerCase("de");
  const relevantStations = stations.filter((match) =>
    match.name.toLocaleLowerCase("de").includes(prefix),
  );
  const stops = mapPlaces([...relevantStations, ...general]);
  if (stops.length >= 3) return stops;
  return [...stops, ...mapPlaces(await search("ADDRESS"), 10 - stops.length)];
}
