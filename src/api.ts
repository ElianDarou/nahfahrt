import type { JourneysPayload } from "../convex/lib/journeys";
import type { Place } from "../convex/lib/places";
import type { Station } from "./store";

const BASE = (import.meta.env.VITE_CONVEX_SITE_URL as string).replace(/\/$/, "");
const TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function get<T>(path: string, query: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}?${new URLSearchParams(query)}`, { signal: combined });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(timeout.aborted ? "timeout" : "offline");
  }
  const body = (await response.json().catch(() => ({}))) as T & { e?: string };
  if (!response.ok) throw new ApiError(body.e ?? "upstream");
  return body;
}

export async function searchPlaces(text: string, near?: string, signal?: AbortSignal): Promise<Place[]> {
  const query: Record<string, string> = { q: text };
  if (near) query.near = near;
  const { r } = await get<{ r: Place[] }>("/v1/places", query, signal);
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
}

export function searchJourneys(query: JourneyQuery, signal?: AbortSignal): Promise<JourneysPayload> {
  const params: Record<string, string> = {
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
  return get<JourneysPayload>("/v1/journeys", params, signal);
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
    case "unknown_place":
      return "Diese Haltestelle ist nicht mehr bekannt. Bitte suche sie neu.";
    default:
      return "Der Datendienst ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal.";
  }
}
