import type { Journey, Leg, TransitLeg } from "../convex/lib/journeys";

const timeFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
const dayFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Berlin",
});
const dayKeyFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

export const formatTime = (minutes: number): string => timeFormat.format(minutes * 60000);
export const formatTimeMs = (ms: number): string => timeFormat.format(ms);
export const formatDay = (minutes: number): string => dayFormat.format(minutes * 60000);
export const dayKey = (minutes: number): string => dayKeyFormat.format(minutes * 60000);

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} Min.`;
  return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
}

export const isWalk = (leg: Leg): leg is { m: "W"; d: number } => leg.m === "W";
export const vehicles = (journey: Journey): TransitLeg[] =>
  journey.l.filter((leg): leg is TransitLeg => !isWalk(leg));

export const actualDeparture = (leg: TransitLeg): number => leg.a + (leg.x ?? 0);
export const actualArrival = (leg: TransitLeg): number => leg.b + (leg.y ?? 0);

/** Minutes between leaving the start and reaching the destination, walks included. */
export function totalMinutes(journey: Journey): number {
  const legs = vehicles(journey);
  if (!legs.length) return 0;
  const before = journey.l[0] && isWalk(journey.l[0]) ? journey.l[0].d : 0;
  const lastLeg = journey.l[journey.l.length - 1];
  const after = lastLeg && isWalk(lastLeg) ? lastLeg.d : 0;
  return actualArrival(legs[legs.length - 1]) - actualDeparture(legs[0]) + before + after;
}

export interface TransferInfo {
  /** Minutes between arriving and the next departure. */
  minutes: number;
  /** Minutes on foot within this transfer. */
  walk: number;
}

/** The transfer before each vehicle except the first, in vehicle order. */
export function transfers(journey: Journey): TransferInfo[] {
  const result: TransferInfo[] = [];
  let previous: TransitLeg | undefined;
  let walk = 0;
  for (const leg of journey.l) {
    if (isWalk(leg)) {
      walk += leg.d;
      continue;
    }
    if (previous) result.push({ minutes: actualDeparture(leg) - actualArrival(previous), walk });
    previous = leg;
    walk = 0;
  }
  return result;
}

export const isCancelled = (journey: Journey): boolean => vehicles(journey).some((leg) => leg.c);

/** A connection that cannot work, or that a small delay would break. */
export function transferRisk(journey: Journey): "broken" | "tight" | undefined {
  const list = transfers(journey);
  if (list.some((transfer) => transfer.minutes < transfer.walk)) return "broken";
  if (list.some((transfer) => transfer.minutes < 5)) return "tight";
  return undefined;
}

export const journeyKey = (journey: Journey): string =>
  vehicles(journey)
    .map((leg) => `${leg.n}@${leg.a}`)
    .join(">");
