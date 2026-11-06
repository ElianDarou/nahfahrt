/**
 * Turns verbose Transitous/MOTIS responses into the small payload the app needs.
 * Pure functions only, so they stay testable without a Convex deployment.
 */

export const ACCEPTED_MODES =
  "BUS,TRAM,SUBWAY,FERRY,SUBURBAN,REGIONAL_RAIL,REGIONAL_FAST_RAIL,FUNICULAR,AERIAL_LIFT";

/** Maximum walk at either end of a trip when the endpoint is a stop (seconds). */
export const SHORT_WALK_SECONDS = 420;
/** Maximum walk when the endpoint is an address (seconds). */
export const LONG_WALK_SECONDS = 1800;
export const MIN_TRANSFER_MINUTES = 3;

export type PlaceType = "stop" | "addr";

export interface UpstreamPlace {
  name?: string;
  track?: string;
  scheduledTrack?: string;
}

export interface UpstreamLeg {
  mode: string;
  startTime: string;
  endTime: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  duration?: number;
  realTime?: boolean;
  cancelled?: boolean;
  tripId?: string;
  routeShortName?: string;
  displayName?: string;
  headsign?: string;
  agencyName?: string;
  from: UpstreamPlace;
  to: UpstreamPlace;
  alerts?: { headerText?: string; descriptionText?: string }[];
}

export interface UpstreamItinerary {
  duration: number;
  transfers?: number;
  startTime: string;
  endTime: string;
  legs: UpstreamLeg[];
}

export interface UpstreamPlan {
  itineraries?: UpstreamItinerary[];
  direct?: UpstreamItinerary[];
  nextPageCursor?: string;
  previousPageCursor?: string;
}

/** A vehicle leg. All times are minutes since the Unix epoch. */
export interface TransitLeg {
  /** Mode: B bus, T tram, U subway, S suburban, R regional, F ferry, O other. */
  m: string;
  /** Line name. */
  n: string;
  /** Destination shown on the vehicle. */
  h?: string;
  /** Boarding stop. */
  f: string;
  /** Alighting stop. */
  t: string;
  /** Scheduled departure. */
  a: number;
  /** Scheduled arrival. */
  b: number;
  /** Departure delay in minutes, when different from zero. */
  x?: number;
  /** Arrival delay in minutes, when different from zero. */
  y?: number;
  /** Boarding platform. */
  g?: string;
  /** Alighting platform. */
  k?: string;
  /** 1 when live data exists for this leg. */
  r?: 1;
  /** 1 when this leg is cancelled. */
  c?: 1;
  /** 1 when this is a rail replacement service. */
  e?: 1;
  /** Disruption texts. */
  w?: string[];
}

/** A walking leg, duration in minutes. */
export interface WalkLeg {
  m: "W";
  d: number;
}

export type Leg = TransitLeg | WalkLeg;

export interface Journey {
  /** Number of transfers. */
  u: number;
  l: Leg[];
}

export interface JourneysPayload {
  j: Journey[];
  /** Cursor for earlier results. */
  p?: string;
  /** Cursor for later results. */
  n?: string;
  /** Walking the entire way takes this many minutes. */
  w?: number;
}

const MODE_CODES: Record<string, string> = {
  BUS: "B",
  TRAM: "T",
  SUBWAY: "U",
  SUBURBAN: "S",
  REGIONAL_RAIL: "R",
  REGIONAL_FAST_RAIL: "R",
  RAIL: "R",
  FERRY: "F",
};

const toMinutes = (iso: string): number => Math.round(Date.parse(iso) / 60000);

/** Replacement services are published under names such as XEVS9 or "SEV RE7". */
const isReplacement = (line: string): boolean => /^(X?EV|SEV)/i.test(line.trim());

/** Fixes feeds that publish names in capitals ("MANNHEIM HBF"). */
export function tidyName(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .split(/(\s+|[-/(),])/)
    .map((word) => {
      if (word === "HBF") return "Hbf";
      if (word.length > 3 && word === word.toLocaleUpperCase("de") && /\p{L}/u.test(word)) {
        return word.charAt(0) + word.slice(1).toLocaleLowerCase("de");
      }
      return word;
    })
    .join("");
}

function mapLeg(leg: UpstreamLeg): Leg {
  if (leg.mode === "WALK") {
    return { m: "W", d: Math.max(1, Math.round((leg.duration ?? 60) / 60)) };
  }
  const line = (leg.routeShortName || leg.displayName || "").trim();
  const scheduledStart = toMinutes(leg.scheduledStartTime ?? leg.startTime);
  const scheduledEnd = toMinutes(leg.scheduledEndTime ?? leg.endTime);
  const out: TransitLeg = {
    m: MODE_CODES[leg.mode] ?? "O",
    n: line,
    f: tidyName(leg.from.name),
    t: tidyName(leg.to.name),
    a: scheduledStart,
    b: scheduledEnd,
  };
  const departureDelay = toMinutes(leg.startTime) - scheduledStart;
  const arrivalDelay = toMinutes(leg.endTime) - scheduledEnd;
  if (departureDelay !== 0) out.x = departureDelay;
  if (arrivalDelay !== 0) out.y = arrivalDelay;
  if (leg.headsign) out.h = tidyName(leg.headsign);
  if (leg.from.track) out.g = leg.from.track;
  if (leg.to.track) out.k = leg.to.track;
  if (leg.realTime) out.r = 1;
  if (leg.cancelled) out.c = 1;
  if (isReplacement(line)) out.e = 1;
  const alerts = (leg.alerts ?? [])
    .map((alert) => (alert.headerText || alert.descriptionText || "").trim().slice(0, 240))
    .filter(Boolean);
  if (alerts.length) out.w = [...new Set(alerts)].slice(0, 3);
  return out;
}

const transitLegs = (itinerary: UpstreamItinerary): UpstreamLeg[] =>
  itinerary.legs.filter((leg) => leg.mode !== "WALK");

function itineraryKey(itinerary: UpstreamItinerary): string {
  return transitLegs(itinerary)
    .map((leg) => `${leg.tripId ?? leg.routeShortName}@${leg.scheduledStartTime ?? leg.startTime}`)
    .join(">");
}

const firstDeparture = (itinerary: UpstreamItinerary): number => {
  const first = transitLegs(itinerary)[0];
  return toMinutes(first?.startTime ?? itinerary.startTime);
};

const lastArrival = (itinerary: UpstreamItinerary): number => {
  const legs = transitLegs(itinerary);
  return toMinutes(legs[legs.length - 1]?.endTime ?? itinerary.endTime);
};

/**
 * Drops results no reasonable traveller wants: leaving no later, yet arriving
 * at least an hour after another result (such as waiting at a station all night).
 */
function dropWastefulWaits(itineraries: UpstreamItinerary[]): UpstreamItinerary[] {
  return itineraries.filter(
    (candidate) =>
      !itineraries.some(
        (other) =>
          other !== candidate &&
          firstDeparture(other) >= firstDeparture(candidate) &&
          lastArrival(other) <= lastArrival(candidate) - 60,
      ),
  );
}

/** A walk may start this much before the requested time, as it does on bahn.de (walk times differ slightly). */
const WALK_TOLERANCE_MINUTES = 5;

export interface MergeOptions {
  /** Requested time in minutes since the epoch; earlier departures are removed. */
  notBefore?: number;
  /** Requested time in minutes since the epoch; later arrivals are removed. */
  notAfter?: number;
  limit?: number;
}

/** Merges one or two upstream responses into the app payload. */
export function mergePlans(plans: UpstreamPlan[], options: MergeOptions = {}): JourneysPayload {
  const unique = new Map<string, UpstreamItinerary>();
  for (const plan of plans) {
    for (const itinerary of plan.itineraries ?? []) {
      if (!transitLegs(itinerary).length) continue;
      const key = itineraryKey(itinerary);
      const known = unique.get(key);
      // Same vehicles, different walk: keep the shortest total trip.
      if (!known || itinerary.duration < known.duration) unique.set(key, itinerary);
    }
  }

  let itineraries = [...unique.values()];
  // Arrival results run towards the requested time, so only the nearest ones help.
  const { notBefore, notAfter, limit = notAfter !== undefined ? 5 : 8 } = options;
  if (notBefore !== undefined) {
    itineraries = itineraries.filter(
      (item) =>
        firstDeparture(item) >= notBefore &&
        toMinutes(item.startTime) >= notBefore - WALK_TOLERANCE_MINUTES,
    );
  }
  if (notAfter !== undefined) {
    itineraries = itineraries.filter(
      (item) =>
        lastArrival(item) <= notAfter &&
        toMinutes(item.endTime) <= notAfter + WALK_TOLERANCE_MINUTES,
    );
  }
  itineraries = dropWastefulWaits(itineraries).sort(
    (left, right) =>
      firstDeparture(left) - firstDeparture(right) || lastArrival(left) - lastArrival(right),
  );
  const limited =
    notAfter !== undefined ? itineraries.slice(-limit) : itineraries.slice(0, limit);

  const payload: JourneysPayload = {
    j: limited.map((itinerary) => ({
      u: Math.max(0, transitLegs(itinerary).length - 1),
      l: itinerary.legs.map(mapLeg),
    })),
  };

  const next = plans.map((plan) => plan.nextPageCursor ?? "").join("~");
  const previous = plans.map((plan) => plan.previousPageCursor ?? "").join("~");
  if (next.replaceAll("~", "")) payload.n = next;
  if (previous.replaceAll("~", "")) payload.p = previous;

  const walkOnly = plans
    .flatMap((plan) => plan.direct ?? [])
    .filter((item) => item.legs.every((leg) => leg.mode === "WALK"))
    .map((item) => Math.round(item.duration / 60));
  if (walkOnly.length && Math.min(...walkOnly) <= 30) payload.w = Math.min(...walkOnly);

  return payload;
}
