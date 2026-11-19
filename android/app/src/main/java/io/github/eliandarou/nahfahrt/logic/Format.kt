package io.github.eliandarou.nahfahrt.logic

import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Leg
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

val Berlin: ZoneId = ZoneId.of("Europe/Berlin")
private val German = Locale.GERMANY
private val timeFormat = DateTimeFormatter.ofPattern("HH:mm", German).withZone(Berlin)
/** "Mi., 19. Nov." as on the web, where Intl wrote the weekday and month short. */
private val dayFormat = DateTimeFormatter.ofPattern("EEE, d. MMM", German).withZone(Berlin)
private val dayKeyFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd", German).withZone(Berlin)

fun nowMinutes(): Double = System.currentTimeMillis() / 60000.0

fun formatTime(minutes: Int): String = timeFormat.format(Instant.ofEpochSecond(minutes * 60L))
fun formatTime(minutes: Double): String = formatTimeMs((minutes * 60000).toLong())
fun formatTimeMs(ms: Long): String = timeFormat.format(Instant.ofEpochMilli(ms))
fun formatDay(minutes: Int): String = dayFormat.format(Instant.ofEpochSecond(minutes * 60L))
fun formatDay(minutes: Double): String = dayFormat.format(Instant.ofEpochMilli((minutes * 60000).toLong()))
fun dayKey(minutes: Int): String = dayKeyFormat.format(Instant.ofEpochSecond(minutes * 60L))
fun dayKey(minutes: Double): String = dayKeyFormat.format(Instant.ofEpochMilli((minutes * 60000).toLong()))

fun formatDuration(minutes: Int): String {
    val hours = minutes / 60
    val rest = minutes % 60
    if (hours == 0) return "$rest Min."
    return if (rest != 0) "$hours Std. $rest Min." else "$hours Std."
}

val Journey.vehicles: List<Leg> get() = l.filter { !it.isWalk }

/** Minutes between leaving the start and reaching the destination, walks included. */
fun totalMinutes(journey: Journey): Int {
    val legs = journey.vehicles
    if (legs.isEmpty()) return 0
    val before = journey.l.firstOrNull()?.takeIf { it.isWalk }?.walkMinutes ?: 0
    val after = journey.l.lastOrNull()?.takeIf { it.isWalk }?.walkMinutes ?: 0
    return legs.last().actualArrival - legs.first().actualDeparture + before + after
}

data class TransferInfo(val minutes: Int, val walk: Int)

/** The transfer before each vehicle except the first, in vehicle order. */
fun transfers(journey: Journey): List<TransferInfo> {
    val result = mutableListOf<TransferInfo>()
    var previous: Leg? = null
    var walk = 0
    for (leg in journey.l) {
        if (leg.isWalk) {
            walk += leg.walkMinutes
            continue
        }
        previous?.let { result += TransferInfo(leg.actualDeparture - it.actualArrival, walk) }
        previous = leg
        walk = 0
    }
    return result
}

fun isCancelled(journey: Journey): Boolean = journey.vehicles.any { it.cancelled }

enum class TransferRisk { Broken, Tight }

/** A connection that cannot work, or that a small delay would break. */
fun transferRisk(journey: Journey): TransferRisk? {
    val list = transfers(journey)
    if (list.any { it.minutes < it.walk }) return TransferRisk.Broken
    if (list.any { it.minutes < 5 }) return TransferRisk.Tight
    return null
}

fun journeyKey(journey: Journey): String = journey.vehicles.joinToString(">") { "${it.n}@${it.a}" }

fun transfersText(count: Int): String = when (count) {
    0 -> "direkt"
    1 -> "1 Umstieg"
    else -> "$count Umstiege"
}

val ModeNames = mapOf(
    "B" to "Bus", "T" to "Tram", "U" to "U-Bahn", "S" to "S-Bahn", "R" to "Zug", "F" to "Fähre", "O" to "Linie",
)

fun lineLabel(leg: Leg): String = leg.n.ifEmpty { ModeNames[leg.m] ?: "Linie" }

fun formatDistance(metres: Double): String =
    if (metres < 1000) "${(Math.round(metres / 10) * 10)} m"
    else {
        val km = Math.round(metres / 100) / 10.0
        if (km % 1.0 == 0.0) "${km.toInt()} km" else "${km.toString().replace('.', ',')} km"
    }
