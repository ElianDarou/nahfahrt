package io.github.eliandarou.nahfahrt.logic

import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Leg

/** Enough to get going, without standing around for long. */
const val LEAD_MINUTES = 10
/** Enough to pack up before the doors open. */
const val ALIGHT_LEAD_MINUTES = 2
/** Room for the ids of one journey. */
const val REMINDER_SLOTS = 16

data class PlannedReminder(val slot: Int, val at: Int, val title: String, val body: String)

private fun platform(track: String?) = track?.let { ", Gl. $it" } ?: ""

/** What to say when. Times come from the latest delays the app knows about. */
fun planReminders(journey: Journey, now: Double): List<PlannedReminder> {
    val legs = journey.vehicles
    val first = legs.first()
    val walks = journey.l.first().isWalk
    val reminders = mutableListOf(
        PlannedReminder(
            slot = 0,
            at = journeyStart(journey) - LEAD_MINUTES,
            title = if (walks) "In $LEAD_MINUTES Min. losgehen" else "${first.n} fährt in $LEAD_MINUTES Min.",
            body = "${if (walks) "${first.n} ab" else "Ab"} ${first.f}${platform(first.g)}, ${formatTime(first.actualDeparture)} Uhr",
        ),
    )
    legs.forEachIndexed { index, leg ->
        val at = leg.actualArrival - ALIGHT_LEAD_MINUTES
        // Too short a ride: the reminder would come before getting on.
        if (at <= leg.actualDeparture) return@forEachIndexed
        val next = legs.getOrNull(index + 1)
        reminders += PlannedReminder(
            slot = index + 1,
            at = at,
            title = "Gleich aussteigen: ${leg.t}",
            body = if (next != null) {
                "Weiter mit ${next.n} ab ${next.f}${platform(next.g)}, ${formatTime(next.actualDeparture)} Uhr"
            } else {
                "Ankunft ${formatTime(leg.actualArrival)} Uhr${platform(leg.k)}"
            },
        )
    }
    return reminders.filter { it.at > now && it.slot < REMINDER_SLOTS }
}

/** The same journey always gets the same ids, which is what makes replacing and cancelling work. */
fun reminderIds(key: String): List<Int> {
    var hash = 0
    // JavaScript iterated code points and took the first UTF-16 unit of each; the same here.
    var index = 0
    while (index < key.length) {
        val codePoint = key.codePointAt(index)
        hash = (hash * 31 + key[index].code) and 0x3ffffff
        index += Character.charCount(codePoint)
    }
    return List(REMINDER_SLOTS) { slot -> hash * REMINDER_SLOTS + slot }
}

private fun timeWithDelay(scheduled: Int, delay: Int?): String =
    if (delay != null && delay != 0) "${formatTime(scheduled + delay)} (${if (delay > 0) "+" else ""}$delay)"
    else formatTime(scheduled)

private fun legLines(leg: Leg): List<String> = buildList {
    val direction = leg.h?.let { " Richtung $it" } ?: ""
    add("${timeWithDelay(leg.a, leg.x)} ${leg.n}$direction ab ${leg.f}${leg.g?.let { ", Gl. $it" } ?: ""}")
    add("${timeWithDelay(leg.b, leg.y)} an ${leg.t}${leg.k?.let { ", Gl. $it" } ?: ""}")
    if (leg.cancelled) add("Fällt aus")
}

/** The connection as plain text, ready to be edited before sharing. */
fun shareText(from: String, to: String, journey: Journey): String {
    val legs = journey.vehicles
    val first = legs.first()
    val last = legs.last()
    val lines = mutableListOf(
        "$from → $to",
        "${formatDay(first.actualDeparture)}, ${formatTime(first.actualDeparture)}–${formatTime(last.actualArrival)} " +
            "(${formatDuration(totalMinutes(journey))}, ${transfersText(journey.u)})",
        "",
    )
    for (leg in journey.l) {
        if (leg.isWalk) lines += "Zu Fuß ${leg.walkMinutes} Min." else lines += legLines(leg)
    }
    return lines.joinToString("\n")
}
