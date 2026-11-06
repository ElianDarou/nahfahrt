import type { TransitLeg } from "../convex/lib/journeys";
import type { Place } from "../convex/lib/places";
import { followTrip, nearbyStops, searchPlaces } from "./api";
import { findKnownStation, regionHint, stationFromPlace, type Station } from "./store";

/** A stop someone pressed on, with whatever is known about it so far. */
export interface StopRef {
  name: string;
  lat?: number;
  lon?: number;
  /** The vehicle this stop belongs to, in case its coordinates have to be asked for. */
  leg?: TransitLeg;
  end?: "from" | "to";
  /** Already a full station, as in the search list. */
  station?: Station;
}

const normalize = (text: string): string =>
  text
    .toLocaleLowerCase("de")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const metresBetween = (place: Place, lat: number, lon: number): number =>
  Math.hypot((place.y - lat) * 111_000, (place.x - lon) * 74_000);

/** The same stop under the same or a town-prefixed name, or else whatever stands right there. */
export function pickStop(places: Place[], name: string, lat: number, lon: number): Place | undefined {
  const wanted = normalize(name);
  const byDistance = [...places].sort(
    (left, right) => metresBetween(left, lat, lon) - metresBetween(right, lat, lon),
  );
  const named = byDistance.find((place) => {
    const candidate = normalize(place.n);
    return candidate === wanted || candidate.endsWith(wanted) || wanted.endsWith(candidate);
  });
  if (named && metresBetween(named, lat, lon) < 400) return named;
  return byDistance[0] && metresBetween(byDistance[0], lat, lon) < 100 ? byDistance[0] : undefined;
}

/** Routable by its coordinates, for when the network cannot tell more about a stop. */
const stationFromCoordinates = (name: string, lat: number, lon: number): Station => ({
  key: `${lat.toFixed(4)},${lon.toFixed(4)}`,
  name,
  lat,
  lon,
  count: 0,
  last: 0,
});

/**
 * Finds a stop's full entry, at the moment someone asks: search responses stay small
 * because they don't carry ids and coordinates for every stop they mention.
 */
export async function resolveStop(ref: StopRef, signal?: AbortSignal): Promise<Station> {
  if (ref.station) return ref.station;
  const known = findKnownStation(ref.name, ref.lat, ref.lon);
  if (known) return known;

  let { lat, lon } = ref;
  if ((lat === undefined || lon === undefined) && ref.leg?.i && ref.end) {
    const { leg, end } = ref;
    const { s: stops } = await followTrip(
      { id: leg.i!, boardAt: leg.a, alightAt: leg.b, update: false },
      signal,
    );
    const stop = end === "from" ? stops[0] : stops[stops.length - 1];
    lat = stop?.la;
    lon = stop?.lo;
  }

  if (lat !== undefined && lon !== undefined) {
    try {
      const match = pickStop(await nearbyStops(lat, lon, signal), ref.name, lat, lon);
      if (match) return stationFromPlace(match);
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    return stationFromCoordinates(ref.name, lat, lon);
  }

  const wanted = normalize(ref.name);
  const places = await searchPlaces(ref.name, regionHint(), signal);
  const match = places.find((place) => normalize(place.n) === wanted) ?? places[0];
  if (!match) throw new Error("unknown stop");
  return stationFromPlace(match);
}
