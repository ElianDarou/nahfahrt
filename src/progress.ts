import type { Journey, TransitLeg } from "../convex/lib/journeys";
import type { TripStop } from "../convex/lib/trip";
import {
  actualArrival,
  actualDeparture,
  formatDay,
  formatDuration,
  formatTime,
  isWalk,
  vehicles,
} from "./format";

export type Phase = "upcoming" | "approach" | "riding" | "stopped" | "transfer" | "final-walk" | "arrived";

export interface Progress {
  phase: Phase;
  headline: string;
  detail?: string;
  /** Share of the whole journey already behind, 0 to 1. */
  share: number;
  /** Index among the vehicles of the leg in use, or next up. */
  vehicle: number;
  /**
   * While riding: how many of this vehicle's stops are behind. When `atStop` is
   * set, the vehicle is standing at the last of them.
   */
  stopsPassed: number;
  atStop: boolean;
}

export const stopArrival = (stop: TripStop): number | undefined =>
  stop.a === undefined ? undefined : stop.a + (stop.x ?? 0);
export const stopDeparture = (stop: TripStop): number | undefined =>
  stop.d === undefined ? undefined : stop.d + (stop.y ?? 0);

/** Minutes between now and a moment ahead, for use after "in". */
export function untilText(minutes: number): string {
  const rounded = Math.ceil(minutes);
  if (rounded <= 0) return "gleich";
  return `in ${formatDuration(rounded)}`;
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const journeyStart = (journey: Journey): number => {
  const first = journey.l[0];
  const walk = first && isWalk(first) ? first.d : 0;
  return actualDeparture(vehicles(journey)[0]) - walk;
};

export const journeyEnd = (journey: Journey): number => {
  const legs = vehicles(journey);
  const last = journey.l[journey.l.length - 1];
  const walk = last && isWalk(last) ? last.d : 0;
  return actualArrival(legs[legs.length - 1]) + walk;
};

const lineWithDirection = (leg: TransitLeg): string =>
  leg.h ? `${leg.n} Richtung ${leg.h}` : leg.n;

const platformText = (platform: string | undefined): string =>
  platform ? `, Gleis ${platform}` : "";

/** Where in the stop list the vehicle is, derived from times rather than GPS. */
function locate(stops: TripStop[], now: number): { passed: number; atStop: boolean } {
  let passed = 0;
  for (const [index, stop] of stops.entries()) {
    const arrival = stopArrival(stop) ?? stopDeparture(stop);
    const departure = stopDeparture(stop) ?? stopArrival(stop);
    if (arrival === undefined || departure === undefined) continue;
    if (now < arrival) return { passed, atStop: false };
    passed = index + 1;
    if (now < departure) return { passed, atStop: true };
  }
  return { passed, atStop: false };
}

export function progressOf(
  journey: Journey,
  stopsByVehicle: (TripStop[] | undefined)[],
  now: number,
): Progress {
  const legs = vehicles(journey);
  const start = journeyStart(journey);
  const end = journeyEnd(journey);
  const share = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 0;
  const base = { share, stopsPassed: 0, atStop: false };
  const first = legs[0];

  if (now < start) {
    const walks = isWalk(journey.l[0]);
    const soon = start - now <= 24 * 60;
    const when = soon
      ? capitalize(untilText(start - now))
      : `${formatDay(start)}, ${formatTime(start)}`;
    return {
      ...base,
      phase: "upcoming",
      vehicle: 0,
      headline: walks && soon ? `${when} losgehen` : when,
      detail: `${lineWithDirection(first)} ab ${first.f}${platformText(first.g)}`,
    };
  }

  if (now < actualDeparture(first)) {
    return {
      ...base,
      phase: "approach",
      vehicle: 0,
      headline: `${first.n} fährt ${untilText(actualDeparture(first) - now)}`,
      detail: `Ab ${first.f}${platformText(first.g)}, ${formatTime(actualDeparture(first))} Uhr`,
    };
  }

  for (const [index, leg] of legs.entries()) {
    const arrival = actualArrival(leg);
    if (now < arrival) {
      const stops = stopsByVehicle[index] ?? [];
      const { passed, atStop } = locate(stops, now);
      const ride = {
        ...base,
        vehicle: index,
        stopsPassed: passed,
        atStop,
      };
      const alight = `Ausstieg ${leg.t} ${untilText(arrival - now)}`;
      const next = stops[passed];
      const nextArrival = next ? stopArrival(next) : undefined;
      if (atStop) {
        return {
          ...ride,
          phase: "stopped",
          headline: `${leg.n} hält in ${stops[passed - 1]?.n ?? leg.f}`,
          detail: alight,
        };
      }
      const nextIsAlight = !next || passed === stops.length - 1;
      return {
        ...ride,
        phase: "riding",
        headline: lineWithDirection(leg),
        detail:
          next?.n && nextArrival !== undefined && !nextIsAlight
            ? `Nächster Halt ${next.n} ${untilText(nextArrival - now)} · ${alight}`
            : alight,
      };
    }

    const following = legs[index + 1];
    if (following && now < actualDeparture(following)) {
      return {
        ...base,
        phase: "transfer",
        vehicle: index + 1,
        stopsPassed: 0,
        headline: `Umstieg in ${leg.t}`,
        detail: `${following.n} ab ${following.f}${platformText(following.g)}, ${untilText(
          actualDeparture(following) - now,
        )}`,
      };
    }
  }

  const lastIndex = legs.length - 1;
  const lastStops = stopsByVehicle[lastIndex]?.length ?? 0;
  if (now < end) {
    return {
      ...base,
      phase: "final-walk",
      vehicle: lastIndex,
      stopsPassed: lastStops,
      headline: "Letztes Stück zu Fuß",
      detail: `Noch etwa ${formatDuration(Math.ceil(end - now))}`,
    };
  }
  return {
    ...base,
    phase: "arrived",
    vehicle: lastIndex,
    stopsPassed: lastStops,
    headline: "Angekommen",
    share: 1,
  };
}
