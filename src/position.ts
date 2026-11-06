import type { Journey } from "../convex/lib/journeys";
import type { TripStop } from "../convex/lib/trip";
import { actualDeparture, isWalk, vehicles } from "./format";
import type { Fix } from "./location";
import { progressOf, type Progress } from "./progress";

/** Closer than this, someone counts as being at a stop. */
const AT_STOP_METRES = 150;
/** Stops are joined by straight lines, while tracks bend: the tolerance has to allow for that. */
const ROUTE_TOLERANCE_METRES = 800;
const ROUTE_TOLERANCE_SHARE = 0.3;
const WALK_METRES_PER_MINUTE = 80;
/** Streets are longer than the straight line that is all the app knows. */
const WALK_DETOUR = 1.25;
/** Worse than this, a position says little about which stop someone is at. */
const WEAK_ACCURACY_METRES = 1000;
/** Segments this close to the nearest count as equally likely; time then decides. */
const AMBIGUOUS_METRES = 300;

interface Point {
  lat: number;
  lon: number;
}

const stopPoint = (stop: TripStop | undefined): Point | undefined =>
  stop?.la !== undefined && stop.lo !== undefined ? { lat: stop.la, lon: stop.lo } : undefined;

/** Flat-earth distance, which is plenty over the length of a walk or a stop distance. */
export function distanceMetres(left: Point, right: Point): number {
  const metresPerLon = 111_320 * Math.cos((((left.lat + right.lat) / 2) * Math.PI) / 180);
  return Math.hypot((left.lat - right.lat) * 110_540, (left.lon - right.lon) * metresPerLon);
}

function project(point: Point, start: Point, end: Point) {
  const metresPerLon = 111_320 * Math.cos((start.lat * Math.PI) / 180);
  const x = (point.lon - start.lon) * metresPerLon;
  const y = (point.lat - start.lat) * 110_540;
  const dx = (end.lon - start.lon) * metresPerLon;
  const dy = (end.lat - start.lat) * 110_540;
  const squared = dx * dx + dy * dy;
  const fraction = squared ? Math.min(1, Math.max(0, (x * dx + y * dy) / squared)) : 0;
  return {
    fraction,
    distance: Math.hypot(x - fraction * dx, y - fraction * dy),
    length: Math.sqrt(squared),
  };
}

export interface RouteMatch {
  vehicle: number;
  /** Stops behind, as in `Progress`. With `atStop`, the last of them is where someone stands. */
  stopsPassed: number;
  atStop: boolean;
  /** Metres from the line between the stops. */
  distance: number;
  onRoute: boolean;
  /** Minutes later than the schedule at this spot; negative when ahead of it. */
  behindSchedule: number;
  /** Where on the route, for reading. */
  where: string;
}

const scheduledAtStop = (stop: TripStop, now: number): number => {
  const arrival = stop.a ?? stop.d ?? now;
  const departure = stop.d ?? stop.a ?? now;
  if (now < arrival) return now - arrival;
  return now > departure ? now - departure : 0;
};

/** Finds the spot on one vehicle's stop list, using the time to tell apart a line's passes of one place. */
export function matchRoute(
  stops: TripStop[],
  vehicle: number,
  fix: Fix,
  now: number,
): RouteMatch | undefined {
  const segments = stops.slice(0, -1).flatMap((stop, index) => {
    const start = stopPoint(stop);
    const end = stopPoint(stops[index + 1]);
    if (!start || !end) return [];
    const leave = stop.d ?? stop.a ?? now;
    const reach = stops[index + 1].a ?? stops[index + 1].d ?? now;
    const { fraction, distance, length } = project(fix, start, end);
    return [{ index, fraction, distance, length, scheduled: leave + fraction * (reach - leave) }];
  });
  if (!segments.length) return undefined;

  const nearest = Math.min(...segments.map((segment) => segment.distance));
  const best = segments
    .filter((segment) => segment.distance <= nearest + AMBIGUOUS_METRES)
    .sort((left, right) => Math.abs(left.scheduled - now) - Math.abs(right.scheduled - now))[0];

  const slack = Math.min(fix.accuracy, 300);
  const onRoute =
    best.distance <= Math.max(ROUTE_TOLERANCE_METRES, best.length * ROUTE_TOLERANCE_SHARE) + slack;
  const reach = AT_STOP_METRES + Math.min(fix.accuracy, 100);
  const start = stops[best.index];
  const end = stops[best.index + 1];
  const nearStart = distanceMetres(fix, stopPoint(start)!) <= reach;
  const nearEnd = distanceMetres(fix, stopPoint(end)!) <= reach;
  const atStop = nearStart || nearEnd;
  // Both stops in reach: the closer one it is.
  const stoppedAt =
    nearStart && (!nearEnd || best.fraction < 0.5) ? best.index : best.index + 1;

  return {
    vehicle,
    stopsPassed: atStop ? stoppedAt + 1 : best.index + 1,
    atStop,
    distance: best.distance,
    onRoute,
    behindSchedule: Math.round(
      atStop ? scheduledAtStop(stops[stoppedAt], now) : now - best.scheduled,
    ),
    where: atStop ? `In ${stops[stoppedAt].n}` : `Zwischen ${start.n} und ${end.n}`,
  };
}

/** The journey as if nothing were late, to answer "where should I be by now?". */
export function planned(
  journey: Journey,
  stopsByVehicle: (TripStop[] | undefined)[],
  now: number,
): Progress {
  const onTime: Journey = {
    ...journey,
    l: journey.l.map((leg) => {
      if (isWalk(leg)) return leg;
      const { x: _departure, y: _arrival, ...rest } = leg;
      return rest;
    }),
  };
  const onTimeStops = stopsByVehicle.map((stops) =>
    stops?.map(({ x: _arrival, y: _departure, ...stop }) => stop),
  );
  return progressOf(onTime, onTimeStops, now);
}

function plannedText(
  journey: Journey,
  stopsByVehicle: (TripStop[] | undefined)[],
  plan: Progress,
): string {
  const leg = vehicles(journey)[plan.vehicle];
  const stops = stopsByVehicle[plan.vehicle];
  switch (plan.phase) {
    case "upcoming":
      return "Noch nicht unterwegs";
    case "approach":
      return `An ${leg.f}, ${leg.n} fährt gleich`;
    case "transfer":
      return `Beim Umstieg in ${leg.f}`;
    case "final-walk":
      return "Letztes Stück zu Fuß";
    case "arrived":
      return "Schon angekommen";
    case "stopped":
      return `In ${stops?.[plan.stopsPassed - 1]?.n ?? leg.f}`;
    default: {
      const behind = stops?.[plan.stopsPassed - 1]?.n;
      const ahead = stops?.[plan.stopsPassed]?.n;
      return behind && ahead ? `Zwischen ${behind} und ${ahead}` : `Mit ${leg.n} unterwegs`;
    }
  }
}

export type Position =
  /** On the way to the stop of the next vehicle. */
  | {
      kind: "walk";
      stop: string;
      metres: number;
      atStop: boolean;
      walkMinutes: number;
      minutesLeft: number;
      plan: string;
    }
  /** On a vehicle's route. */
  | { kind: "route"; match: RouteMatch; plan: string; progress: Progress }
  /** Far from where the journey should be. */
  | { kind: "off"; metres: number; plan: string }
  | { kind: "weak"; accuracy: number };

/** Compares a position with the journey. Null when the two have nothing to say to each other. */
export function describePosition(
  journey: Journey,
  stopsByVehicle: (TripStop[] | undefined)[],
  fix: Fix,
  now: number,
): Position | null {
  if (fix.accuracy > WEAK_ACCURACY_METRES) return { kind: "weak", accuracy: fix.accuracy };

  const progress = progressOf(journey, stopsByVehicle, now);
  const plan = planned(journey, stopsByVehicle, now);
  const planText = plannedText(journey, stopsByVehicle, plan);

  if (progress.phase === "final-walk" || progress.phase === "arrived") return null;

  if (progress.phase === "riding" || progress.phase === "stopped") {
    // Without live data the clock can run ahead of a late bus, so earlier vehicles count too.
    const matches: RouteMatch[] = [];
    for (let vehicle = progress.vehicle; vehicle >= 0; vehicle -= 1) {
      const stops = stopsByVehicle[vehicle];
      const match = stops && matchRoute(stops, vehicle, fix, now);
      if (match) matches.push(match);
    }
    const found = matches.find((match) => match.onRoute);
    if (found) return { kind: "route", match: found, plan: planText, progress };
    return matches.length
      ? { kind: "off", metres: Math.round(matches[0].distance), plan: planText }
      : null;
  }

  const stop = stopsByVehicle[progress.vehicle]?.[0];
  const point = stopPoint(stop);
  if (!point) return null;
  const leg = vehicles(journey)[progress.vehicle];
  const metres = Math.round(distanceMetres(fix, point));
  return {
    kind: "walk",
    stop: leg.f,
    metres,
    atStop: metres <= AT_STOP_METRES + Math.min(fix.accuracy, 100),
    walkMinutes: Math.ceil((metres * WALK_DETOUR) / WALK_METRES_PER_MINUTE),
    minutesLeft: Math.ceil(actualDeparture(leg) - now),
    plan: planText,
  };
}

export const formatDistance = (metres: number): string =>
  metres < 1000
    ? `${Math.round(metres / 10) * 10} m`
    : `${(metres / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`;

export function scheduleText(behind: number): string {
  if (Math.abs(behind) <= 1) return "Im Fahrplan";
  return behind > 0 ? `${behind} Min. hinter dem Fahrplan` : `${-behind} Min. vor dem Fahrplan`;
}
