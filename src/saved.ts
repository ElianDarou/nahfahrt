import type { Journey, TransitLeg } from "../convex/lib/journeys";
import type { TripPayload, TripStop } from "../convex/lib/trip";
import { isWalk, journeyKey, vehicles } from "./format";
import { journeyEnd } from "./progress";

export interface SavedJourney {
  key: string;
  from: string;
  to: string;
  journey: Journey;
  /** Stops of each vehicle, once loaded. */
  stops: (TripStop[] | undefined)[];
  /** When live data last arrived, in milliseconds since the epoch. */
  updatedAt?: number;
  /** 1 when the user asked for reminders. */
  bell?: 1;
}

const SAVED = "nf.saved.v1";
/** A finished journey stays this long, in case someone wants a last look. */
const EXPIRY_GRACE_MINUTES = 15;
const MAX_SAVED = 30;

export const isExpired = (entry: Pick<SavedJourney, "journey">, nowMinutes: number): boolean =>
  journeyEnd(entry.journey) + EXPIRY_GRACE_MINUTES < nowMinutes;

function readAll(): SavedJourney[] {
  try {
    const raw = localStorage.getItem(SAVED);
    return raw ? (JSON.parse(raw) as SavedJourney[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: SavedJourney[]): void {
  try {
    localStorage.setItem(SAVED, JSON.stringify(entries));
  } catch {
    // Storage is a convenience: the app keeps working without it.
  }
}

/** Returns what is still current, soonest first, and forgets the rest. */
export function getSaved(now = Date.now() / 60000): SavedJourney[] {
  const all = readAll();
  const current = all.filter((entry) => !isExpired(entry, now));
  if (current.length !== all.length) writeAll(current);
  return current.sort((left, right) => journeyEnd(left.journey) - journeyEnd(right.journey));
}

export const findSaved = (key: string): SavedJourney | undefined =>
  getSaved().find((entry) => entry.key === key);

export const savedKey = (journey: Journey): string => journeyKey(journey);

export function saveJourney(from: string, to: string, journey: Journey): SavedJourney {
  const entry: SavedJourney = {
    key: savedKey(journey),
    from,
    to,
    journey,
    stops: vehicles(journey).map(() => undefined),
  };
  const others = getSaved().filter((known) => known.key !== entry.key);
  writeAll([...others, entry].slice(-MAX_SAVED));
  return entry;
}

export function removeSaved(key: string): void {
  writeAll(readAll().filter((entry) => entry.key !== key));
}

export function storeSaved(entry: SavedJourney): void {
  writeAll(readAll().map((known) => (known.key === entry.key ? entry : known)));
}

/** Carries live data of a vehicle's first and last stop over to its leg. */
function updateLeg(leg: TransitLeg, stops: TripStop[], payload: TripPayload): TransitLeg {
  const updated: TransitLeg = { ...leg };
  const board = stops[0];
  const alight = stops[stops.length - 1];
  const assign = (field: "x" | "y", value: number | undefined) => {
    if (value) updated[field] = value;
    else delete updated[field];
  };
  assign("x", board?.y);
  assign("y", alight?.x);
  if (board?.g) updated.g = board.g;
  if (alight?.g) updated.k = alight.g;
  if (payload.r) updated.r = 1;
  else delete updated.r;
  if (payload.c || board?.c || alight?.c) updated.c = 1;
  else delete updated.c;
  return updated;
}

/**
 * Applies a trip response. Updates carry no names, so they need the stop list from
 * an earlier full response and return null when it no longer fits.
 */
export function applyTrip(
  entry: SavedJourney,
  vehicle: number,
  payload: TripPayload,
  isUpdate: boolean,
  now = Date.now(),
): SavedJourney | null {
  let stops = payload.s;
  if (isUpdate) {
    const known = entry.stops[vehicle];
    if (!known || known.length !== payload.s.length) return null;
    stops = known.map((stop, index) => {
      const fresh = payload.s[index];
      return { n: stop.n, a: stop.a, d: stop.d, la: stop.la, lo: stop.lo, ...fresh };
    });
  }

  let seen = -1;
  const legs = entry.journey.l.map((leg) => {
    if (isWalk(leg)) return leg;
    seen += 1;
    return seen === vehicle && stops.length ? updateLeg(leg, stops, payload) : leg;
  });
  const allStops = [...entry.stops];
  allStops[vehicle] = stops;
  return { ...entry, journey: { ...entry.journey, l: legs }, stops: allStops, updatedAt: now };
}

/** Stop lists saved by older versions lack the coordinates that position and actions need. */
export const hasCoordinates = (stops: TripStop[] | undefined): boolean =>
  !!stops?.length && stops.every((stop) => stop.la !== undefined);

/** Vehicles worth asking about: in use or starting within the next 90 minutes. */
export function vehiclesToFollow(journey: Journey, nowMinutes: number): number[] {
  return vehicles(journey).flatMap((leg, index) => {
    const arrival = leg.b + (leg.y ?? 0);
    const departure = leg.a + (leg.x ?? 0);
    return arrival > nowMinutes - 5 && departure - nowMinutes <= 90 && leg.i ? [index] : [];
  });
}
