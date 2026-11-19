package io.github.eliandarou.nahfahrt.platform

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.github.eliandarou.nahfahrt.MainActivity
import io.github.eliandarou.nahfahrt.R
import io.github.eliandarou.nahfahrt.data.Files
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.logic.formatTime
import io.github.eliandarou.nahfahrt.logic.nowMinutes
import io.github.eliandarou.nahfahrt.logic.planReminders
import io.github.eliandarou.nahfahrt.logic.reminderIds
import io.github.eliandarou.nahfahrt.model.SavedJourney

/**
 * Reminders for saved connections: when to leave and when to get off. Android's AlarmManager
 * wakes the app's receiver at the minute, also with the app closed; after a restart of the
 * phone the receiver puts everything back.
 */
object Reminders {
    private const val CHANNEL = "reminders"
    private const val ACTION = "io.github.eliandarou.nahfahrt.REMIND"
    const val EXTRA_KEY = "key"
    private const val EXTRA_ID = "id"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"

    /** What is scheduled per journey, so unchanged plans cost no system calls. */
    private val scheduled = HashMap<String, String>()

    private fun alarmIntent(context: Context, id: Int, extras: Intent.() -> Unit = {}): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            id,
            Intent(context, ReminderReceiver::class.java).setAction(ACTION).apply(extras),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun alarms(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    @Synchronized
    private fun cancelFor(context: Context, key: String) {
        scheduled.remove(key)
        val manager = alarms(context)
        reminderIds(key).forEach { manager.cancel(alarmIntent(context, it)) }
    }

    private fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Erinnerungen", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Zeit zum Losgehen und zum Aussteigen bei gemerkten Verbindungen"
                enableVibration(true)
            },
        )
    }

    /** Returns the time of the first reminder, or null when none is left for this journey. */
    @Synchronized
    private fun scheduleFor(context: Context, entry: SavedJourney): Int? {
        val plan = planReminders(entry.journey, nowMinutes())
        val signature = plan.toString()
        if (scheduled[entry.key] == signature) return plan.firstOrNull()?.at
        cancelFor(context, entry.key)
        if (plan.isEmpty()) return null
        ensureChannel(context)
        val manager = alarms(context)
        val exact = Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()
        val ids = reminderIds(entry.key)
        for (reminder in plan) {
            val id = ids[reminder.slot]
            val intent = alarmIntent(context, id) {
                putExtra(EXTRA_ID, id)
                putExtra(EXTRA_KEY, entry.key)
                putExtra(EXTRA_TITLE, reminder.title)
                putExtra(EXTRA_BODY, reminder.body)
            }
            val at = reminder.at * 60_000L
            if (exact) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            else manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
        }
        scheduled[entry.key] = signature
        return plan.first().at
    }

    data class BellResult(val entry: SavedJourney, val text: String)

    /** Switches the bell of a saved connection and says what came of it. */
    suspend fun setBell(context: Context, entry: SavedJourney, on: Boolean): BellResult {
        if (!on) {
            cancelFor(context, entry.key)
            val updated = entry.copy(bell = null)
            Saved.store(updated)
            return BellResult(updated, "Erinnerung aus")
        }
        if (!Permissions.notifications(context) || !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return BellResult(entry, "Benachrichtigungen sind für Nahfahrt aus. Du kannst sie in den Android-Einstellungen erlauben.")
        }
        val updated = entry.copy(bell = 1)
        val first = scheduleFor(context, updated) ?: return BellResult(entry, "Für diese Fahrt steht keine Erinnerung mehr an.")
        Saved.store(updated)
        return BellResult(updated, "Erinnerung an, die erste um ${formatTime(first)} Uhr")
    }

    /** Moves reminders along when new delays came in. */
    fun sync(context: Context, entry: SavedJourney) {
        if (entry.hasBell) scheduleFor(context, entry)
    }

    fun syncAll(context: Context) {
        Saved.all().filter { it.hasBell }.forEach { scheduleFor(context, it) }
    }

    /** Forgets a saved connection along with anything scheduled for it. */
    fun forget(context: Context, key: String) {
        Saved.remove(key)
        cancelFor(context, key)
    }

    internal fun show(context: Context, intent: Intent) {
        val id = intent.getIntExtra(EXTRA_ID, 0)
        val key = intent.getStringExtra(EXTRA_KEY) ?: return
        if (!Permissions.hasNotifications(context)) return
        ensureChannel(context)
        val open = PendingIntent.getActivity(
            context,
            id,
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .putExtra(EXTRA_KEY, key)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_nahfahrt)
            .setColor(0xFF0B7A50.toInt())
            .setContentTitle(intent.getStringExtra(EXTRA_TITLE))
            .setContentText(intent.getStringExtra(EXTRA_BODY))
            .setStyle(NotificationCompat.BigTextStyle().bigText(intent.getStringExtra(EXTRA_BODY)))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // The permission was taken back in the meantime.
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = Reminders.show(context, intent)
}

/** Alarms do not survive a restart or an update; this puts them back from the saved connections. */
class RestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Files.init(context)
        Reminders.syncAll(context)
        Files.awaitWrites()
    }
}
