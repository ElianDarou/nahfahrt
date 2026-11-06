import type { JourneysPayload } from "../convex/lib/journeys";
import type { Place } from "../convex/lib/places";
import { byUsage, usageScore } from "./rank";

export interface Station {
  key: string;
  name: string;
  sub?: string;
  id?: string;
  lat: number;
  lon: number;
  addr?: boolean;
  count: number;
  last: number;
  fav?: boolean;
  label?: string;
  /** The current position: coordinates are fetched per search and never stored. */
  me?: boolean;
}

export const LOCATION_STATION: Station = {
  key: "me",
  name: "Mein Standort",
  lat: 0,
  lon: 0,
  addr: true,
  count: 0,
  last: 0,
  me: true,
};

export interface Route {
  from: string;
  to: string;
  count: number;
  last: number;
}

interface CachedJourneys {
  from: string;
  to: string;
  savedAt: number;
  payload: JourneysPayload;
}

const STATIONS = "nf.stations.v1";
const ROUTES = "nf.routes.v1";
const JOURNEYS = "nf.journeys.v1";
const MAX_STATIONS = 200;
const MAX_ROUTES = 30;
const MAX_CACHED_JOURNEYS = 10;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience: the app keeps working without it.
  }
}

/** Coordinates stay stable when upstream datasets rename their stop ids. */
const placeKey = (place: Place): string => `${place.y.toFixed(4)},${place.x.toFixed(4)}`;

export function stationFromPlace(place: Place): Station {
  const isAddress = place.a === 1;
  return {
    key: placeKey(place),
    // "Musterstraße 1" alone says little in a list or a results title.
    name: isAddress && place.s ? `${place.s}, ${place.n}` : place.n,
    sub: isAddress ? undefined : place.s,
    id: place.i,
    lat: place.y,
    lon: place.x,
    addr: isAddress,
    count: 0,
    last: 0,
  };
}

export const getStations = (): Station[] => read<Station[]>(STATIONS, []);

function saveStations(stations: Station[]): void {
  const kept = byUsage(stations).slice(0, MAX_STATIONS);
  write(STATIONS, kept);
}

function upsert(station: Station, change: (known: Station) => Station): Station {
  if (station.me) return station;
  const stations = getStations();
  const index = stations.findIndex((known) => known.key === station.key);
  const known = index >= 0 ? stations[index] : station;
  // Ids and names from a fresh search replace older ones.
  const updated = change({ ...known, name: station.name, sub: station.sub, id: station.id ?? known.id });
  if (index >= 0) stations[index] = updated;
  else stations.push(updated);
  saveStations(stations);
  return updated;
}

export const recordStationUse = (station: Station): Station =>
  upsert(station, (known) => ({ ...known, count: known.count + 1, last: Date.now() }));

export const toggleFavourite = (station: Station): Station =>
  upsert(station, (known) => ({ ...known, fav: !known.fav, last: known.last || Date.now() }));

export const renameStation = (station: Station, label: string): Station =>
  upsert(station, (known) => ({ ...known, label: label.trim() || undefined }));

export function removeFromHistory(station: Station): void {
  const stations = getStations();
  if (station.fav) {
    saveStations(stations.map((s) => (s.key === station.key ? { ...s, count: 0, last: 0 } : s)));
  } else {
    saveStations(stations.filter((s) => s.key !== station.key));
  }
}

/** Clears the history; favourites stay. */
export function clearHistory(): void {
  saveStations(getStations().filter((s) => s.fav).map((s) => ({ ...s, count: 0, last: 0 })));
}

/** What a place from the backend, or a stop of a trip, is already known as. */
export function findKnownStation(name: string, lat?: number, lon?: number): Station | undefined {
  const named = getStations().filter((station) => station.name === name);
  if (lat === undefined || lon === undefined) return named.length === 1 ? named[0] : undefined;
  return named.find(
    (station) => Math.hypot((station.lat - lat) * 111_000, (station.lon - lon) * 74_000) < 500,
  );
}

export const displayName = (station: Station): string => station.label || station.name;

export function displaySub(station: Station): string | undefined {
  if (!station.label) return station.sub;
  return station.sub ? `${station.name}, ${station.sub}` : station.name;
}

/** The most used station stands in for the user's region, without any location permission. */
export function regionHint(): string | undefined {
  const top = getStations()
    .filter((s) => s.count > 0)
    .sort((left, right) => usageScore(right) - usageScore(left))[0];
  return top ? `${top.lat.toFixed(2)},${top.lon.toFixed(2)}` : undefined;
}

export const getRoutes = (): Route[] => read<Route[]>(ROUTES, []);

export function recordRoute(from: Station, to: Station): void {
  if (from.me || to.me) return;
  const routes = getRoutes();
  const known = routes.find((route) => route.from === from.key && route.to === to.key);
  if (known) {
    known.count += 1;
    known.last = Date.now();
  } else {
    routes.push({ from: from.key, to: to.key, count: 1, last: Date.now() });
  }
  write(ROUTES, topRoutesOf(routes).slice(0, MAX_ROUTES));
}

const topRoutesOf = (routes: Route[]): Route[] =>
  [...routes].sort((left, right) => usageScore(right) - usageScore(left));

export function topRoutes(limit: number): { route: Route; from: Station; to: Station }[] {
  const stations = new Map(getStations().map((station) => [station.key, station]));
  return topRoutesOf(getRoutes())
    .flatMap((route) => {
      const from = stations.get(route.from);
      const to = stations.get(route.to);
      return from && to ? [{ route, from, to }] : [];
    })
    .slice(0, limit);
}

export function removeRoute(route: Route): void {
  write(
    ROUTES,
    getRoutes().filter((known) => known.from !== route.from || known.to !== route.to),
  );
}

export function saveJourneys(from: Station, to: Station, payload: JourneysPayload): void {
  if (from.me || to.me) return;
  const others = read<CachedJourneys[]>(JOURNEYS, []).filter(
    (entry) => entry.from !== from.key || entry.to !== to.key,
  );
  write(
    JOURNEYS,
    [{ from: from.key, to: to.key, savedAt: Date.now(), payload }, ...others].slice(
      0,
      MAX_CACHED_JOURNEYS,
    ),
  );
}

export function loadJourneys(
  from: Station,
  to: Station,
): { savedAt: number; payload: JourneysPayload } | undefined {
  if (from.me || to.me) return undefined;
  return read<CachedJourneys[]>(JOURNEYS, []).find(
    (entry) => entry.from === from.key && entry.to === to.key,
  );
}
