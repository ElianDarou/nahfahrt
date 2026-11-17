import type { JourneysPayload } from "../convex/lib/journeys";
import type { Place } from "../convex/lib/places";
import type { TripPayload } from "../convex/lib/trip";
import { logFetch } from "./perf";
import { RequestCache, untilAborted } from "./request-cache";
import type { Station } from "./store";

const BASE = (import.meta.env.VITE_CONVEX_SITE_URL as string).replace(/\/$/, "");
const TIMEOUT_MS = 20_000;

/**
 * The server answers are the same for a whole minute (it rounds the requested time down), so
 * a prefetched search serves the tap that follows it. Updates of a running vehicle are never
 * cached: they would show yesterday's delay.
 */
const journeys = new RequestCache<JourneysPayload>(60_000);
const trips = new RequestCache<TripPayload>(20_000);

const stableKey = (params: Record<string, string>): string =>
  Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function get<T>(
  path: string,
  query: Record<string, string>,
  signal?: AbortSignal,
  options: RequestInit = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  const started = performance.now();
  try {
    response = await fetch(`${BASE}${path}?${new URLSearchParams(query)}`, { ...options, signal: combined });
  } catch (error) {
    logFetch(path, started);
    if (signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? "timeout" : "offline");
  }
  const body = (await response.json().catch(() => ({}))) as T & { e?: string };
  logFetch(path, started, response);
  if (!response.ok) throw new ApiError(body.e ?? "upstream");
  return body;
}

export async function searchPlaces(text: string, near?: string, signal?: AbortSignal): Promise<Place[]> {
  const query: Record<string, string> = { q: text };
  if (near) query.near = near;
  const { r } = await get<{ r: Place[] }>("/v1/places", query, signal);
  return r;
}

/** Stops around a position. Never cached, as the position is part of the address. */
export async function nearbyStops(lat: number, lon: number, signal?: AbortSignal): Promise<Place[]> {
  const { r } = await get<{ r: Place[] }>(
    "/v1/nearby",
    { at: `${lat},${lon}` },
    signal,
    { cache: "no-store" },
  );
  return r;
}

const coordinates = (station: Station): string => `${station.lat},${station.lon}`;

export interface JourneyQuery {
  from: Station;
  to: Station;
  /** Requested time in milliseconds since the epoch. */
  at: number;
  arriveBy: boolean;
  cursor?: string;
  filters?: Record<string, string>;
}

function journeyParams(query: JourneyQuery): Record<string, string> {
  const params: Record<string, string> = {
    ...query.filters,
    from: query.from.id ?? coordinates(query.from),
    to: query.to.id ?? coordinates(query.to),
    at: new Date(Math.floor(query.at / 60000) * 60000).toISOString(),
  };
  if (query.from.id) params.fromLL = coordinates(query.from);
  if (query.to.id) params.toLL = coordinates(query.to);
  if (query.from.addr) params.fromType = "addr";
  if (query.to.addr) params.toType = "addr";
  if (query.arriveBy) params.arrive = "1";
  if (query.cursor) params.cursor = query.cursor;
  // The exact position is part of the address and must not be shared between searches.
  if (query.from.me || query.to.me) params.priv = "1";
  return params;
}

const privateQuery = (query: JourneyQuery): boolean => !!(query.from.me || query.to.me);

export function searchJourneys(query: JourneyQuery, signal?: AbortSignal): Promise<JourneysPayload> {
  const params = journeyParams(query);
  const task = privateQuery(query)
    ? get<JourneysPayload>("/v1/journeys", params, undefined, { cache: "no-store" })
    : journeys.run(stableKey(params), () => get<JourneysPayload>("/v1/journeys", params));
  return untilAborted(task, signal);
}

/**
 * Starts the search before the button is pressed. Only plain searches are worth it: a cursor
 * belongs to a list on screen, and a position is never shared.
 */
export function prefetchJourneys(query: JourneyQuery): void {
  if (privateQuery(query) || query.cursor) return;
  const params = journeyParams(query);
  void journeys
    .run(stableKey(params), () => get<JourneysPayload>("/v1/journeys", params))
    .catch(() => undefined);
}

/** An answer that is ready right now, for a screen that must not wait a frame. */
export function peekJourneys(query: JourneyQuery): JourneysPayload | undefined {
  if (privateQuery(query)) return undefined;
  return journeys.get(stableKey(journeyParams(query)));
}

export interface TripQuery {
  id: string;
  boardAt: number;
  alightAt: number;
  update: boolean;
}

function tripParams(trip: TripQuery): Record<string, string> {
  const query: Record<string, string> = {
    id: trip.id,
    a: String(trip.boardAt),
    b: String(trip.alightAt),
  };
  if (trip.update) query.u = "1";
  return query;
}

export function followTrip(trip: TripQuery, signal?: AbortSignal): Promise<TripPayload> {
  const params = tripParams(trip);
  const task = trip.update
    ? get<TripPayload>("/v1/trip", params)
    : trips.run(stableKey(params), () => get<TripPayload>("/v1/trip", params));
  return untilAborted(task, signal);
}

/** Loads the stops of a vehicle the live view is likely to open next. */
export function prefetchTrip(trip: TripQuery): void {
  const params = tripParams(trip);
  void trips.run(stableKey(params), () => get<TripPayload>("/v1/trip", params)).catch(() => undefined);
}

export function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "upstream";
  switch (code) {
    case "offline":
      return "Keine Internetverbindung.";
    case "timeout":
      return "Das Netz ist gerade zu langsam. Bitte versuche es noch einmal.";
    case "daily_limit":
      return "Das Tageslimit des kostenlosen Datendienstes ist erreicht. Morgen geht es weiter.";
    case "location_denied":
      return "Der Standort ist für Nahfahrt nicht freigegeben. Du kannst ihn in den Android-Einstellungen erlauben.";
    case "location_off":
      return "Dein Standort ist gerade nicht verfügbar. Ist er am Handy eingeschaltet?";
    case "location_timeout":
      return "Dein Standort konnte nicht bestimmt werden. Versuche es draußen noch einmal.";
    case "unknown_place":
      return "Diese Haltestelle ist nicht mehr bekannt. Bitte suche sie neu.";
    default:
      return "Der Datendienst ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.";
  }
}
