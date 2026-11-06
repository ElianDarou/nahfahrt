import { actualArrival, actualDeparture, formatTime, isWalk, vehicles } from "./format";
import { journeyStart } from "./progress";
import type { SavedJourney } from "./saved";

/** Enough to get going, without standing around for long. */
export const LEAD_MINUTES = 10;
/** Enough to pack up before the doors open. */
export const ALIGHT_LEAD_MINUTES = 2;
/** Room for the ids of one journey. */
export const REMINDER_SLOTS = 16;

export interface PlannedReminder {
  slot: number;
  /** Minutes since the epoch. */
  at: number;
  title: string;
  body: string;
}

const platform = (track: string | undefined): string => (track ? `, Gl. ${track}` : "");

/** What to say when. Times come from the latest delays the app knows about. */
export function planReminders(entry: Pick<SavedJourney, "journey">, now: number): PlannedReminder[] {
  const { journey } = entry;
  const legs = vehicles(journey);
  const first = legs[0];
  const walks = isWalk(journey.l[0]);
  const reminders: PlannedReminder[] = [
    {
      slot: 0,
      at: journeyStart(journey) - LEAD_MINUTES,
      title: walks ? `In ${LEAD_MINUTES} Min. losgehen` : `${first.n} fährt in ${LEAD_MINUTES} Min.`,
      body: `${walks ? `${first.n} ab` : "Ab"} ${first.f}${platform(first.g)}, ${formatTime(actualDeparture(first))} Uhr`,
    },
  ];

  legs.forEach((leg, index) => {
    const at = actualArrival(leg) - ALIGHT_LEAD_MINUTES;
    // Too short a ride: the reminder would come before getting on.
    if (at <= actualDeparture(leg)) return;
    const next = legs[index + 1];
    reminders.push({
      slot: index + 1,
      at,
      title: `Gleich aussteigen: ${leg.t}`,
      body: next
        ? `Weiter mit ${next.n} ab ${next.f}${platform(next.g)}, ${formatTime(actualDeparture(next))} Uhr`
        : `Ankunft ${formatTime(actualArrival(leg))} Uhr${platform(leg.k)}`,
    });
  });

  return reminders.filter((reminder) => reminder.at > now && reminder.slot < REMINDER_SLOTS);
}

/** The same journey always gets the same ids, which is what makes replacing and cancelling work. */
export function reminderIds(key: string): number[] {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) & 0x3ffffff;
  return Array.from({ length: REMINDER_SLOTS }, (_, slot) => hash * REMINDER_SLOTS + slot);
}
