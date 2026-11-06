import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { formatTime } from "./format";
import { planReminders, reminderIds } from "./reminder-plan";
import { getSaved, removeSaved, storeSaved, type SavedJourney } from "./saved";

const CHANNEL = "reminders";

export const canRemind = (): boolean => Capacitor.isNativePlatform();

const scheduled = new Map<string, string>();

async function cancelFor(key: string): Promise<void> {
  scheduled.delete(key);
  await LocalNotifications.cancel({
    notifications: reminderIds(key).map((id) => ({ id })),
  });
}

async function scheduleFor(entry: SavedJourney): Promise<number | undefined> {
  const now = Date.now() / 60000;
  const plan = planReminders(entry, now);
  const signature = JSON.stringify(plan);
  if (scheduled.get(entry.key) === signature) return plan[0]?.at;
  await cancelFor(entry.key);
  if (!plan.length) return undefined;
  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: "Erinnerungen",
    description: "Zeit zum Losgehen und zum Aussteigen bei gemerkten Verbindungen",
    importance: 4,
    vibration: true,
  });
  // Without the permission this would open the system settings on every update.
  const { exact_alarm: exact } = await LocalNotifications.checkExactNotificationSetting();
  const ids = reminderIds(entry.key);
  await LocalNotifications.schedule({
    notifications: plan.map((reminder) => ({
      id: ids[reminder.slot],
      title: reminder.title,
      body: reminder.body,
      channelId: CHANNEL,
      isExactNotification: exact === "granted",
      schedule: { at: new Date(reminder.at * 60000), allowWhileIdle: true },
      extra: { key: entry.key },
    })),
  });
  scheduled.set(entry.key, signature);
  return plan[0].at;
}

async function allowed(): Promise<boolean> {
  const { display } = await LocalNotifications.checkPermissions();
  if (display === "granted") return true;
  return (await LocalNotifications.requestPermissions()).display === "granted";
}

/** Switches the bell of a saved connection and says what came of it. */
export async function setBell(
  entry: SavedJourney,
  on: boolean,
): Promise<{ entry: SavedJourney; text: string }> {
  if (!on) {
    await cancelFor(entry.key);
    const { bell: _bell, ...rest } = entry;
    storeSaved(rest);
    return { entry: rest, text: "Erinnerung aus" };
  }
  if (!(await allowed())) {
    return {
      entry,
      text: "Benachrichtigungen sind für Nahfahrt aus. Du kannst sie in den Android-Einstellungen erlauben.",
    };
  }
  const updated: SavedJourney = { ...entry, bell: 1 };
  const first = await scheduleFor(updated);
  if (first === undefined) return { entry, text: "Für diese Fahrt steht keine Erinnerung mehr an." };
  storeSaved(updated);
  return { entry: updated, text: `Erinnerung an, die erste um ${formatTime(first)} Uhr` };
}

/** Moves reminders along when new delays came in. */
export async function syncReminders(entry: SavedJourney): Promise<void> {
  if (canRemind() && entry.bell) await scheduleFor(entry);
}

export async function syncAllReminders(): Promise<void> {
  if (!canRemind()) return;
  await Promise.all(getSaved().filter((entry) => entry.bell).map(scheduleFor));
}

/** Forgets a saved connection along with anything scheduled for it. */
export function forgetSaved(key: string): void {
  removeSaved(key);
  if (canRemind()) void cancelFor(key).catch(() => undefined);
}

/** Tapping a reminder opens the connection it belongs to. Returns how to stop listening. */
export function onReminderTap(open: (key: string) => void): () => void {
  if (!canRemind()) return () => undefined;
  const listener = LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
    const key = (event.notification.extra as { key?: string } | undefined)?.key;
    if (key) open(key);
  });
  return () => void listener.then((handle) => handle.remove());
}
