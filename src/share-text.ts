import type { Journey, TransitLeg } from "../convex/lib/journeys";
import {
  actualArrival,
  actualDeparture,
  formatDay,
  formatDuration,
  formatTime,
  isWalk,
  totalMinutes,
  vehicles,
} from "./format";

const timeWithDelay = (scheduled: number, delay: number | undefined): string =>
  delay ? `${formatTime(scheduled + delay)} (${delay > 0 ? "+" : ""}${delay})` : formatTime(scheduled);

const legLines = (leg: TransitLeg): string[] => {
  const direction = leg.h ? ` Richtung ${leg.h}` : "";
  const lines = [
    `${timeWithDelay(leg.a, leg.x)} ${leg.n}${direction} ab ${leg.f}${leg.g ? `, Gl. ${leg.g}` : ""}`,
    `${timeWithDelay(leg.b, leg.y)} an ${leg.t}${leg.k ? `, Gl. ${leg.k}` : ""}`,
  ];
  if (leg.c) lines.push("Fällt aus");
  return lines;
};

export const transfersText = (count: number): string =>
  count === 0 ? "direkt" : count === 1 ? "1 Umstieg" : `${count} Umstiege`;

/** The connection as plain text, ready to be edited before sharing. */
export function shareText(from: string, to: string, journey: Journey): string {
  const legs = vehicles(journey);
  const first = legs[0];
  const last = legs[legs.length - 1];
  const lines = [
    `${from} → ${to}`,
    `${formatDay(actualDeparture(first))}, ${formatTime(actualDeparture(first))}–${formatTime(actualArrival(last))} (${formatDuration(totalMinutes(journey))}, ${transfersText(journey.u)})`,
    "",
  ];
  for (const leg of journey.l) {
    if (isWalk(leg)) lines.push(`Zu Fuß ${leg.d} Min.`);
    else lines.push(...legLines(leg));
  }
  return lines.join("\n");
}
