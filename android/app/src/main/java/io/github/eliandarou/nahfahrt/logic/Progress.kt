package io.github.eliandarou.nahfahrt.logic

import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Leg
import io.github.eliandarou.nahfahrt.model.TripStop
import kotlin.math.ceil

enum class Phase { Upcoming, Approach, Riding, Stopped, Transfer, FinalWalk, Arrived }

data class Progress(
    val phase: Phase,
    val headline: String,
    val detail: String? = null,
    /** Share of the whole journey already behind, 0 to 1. */
    val share: Double,
    /** Index among the vehicles of the leg in use, or next up. */
    val vehicle: Int,
    /** While riding: how many of this vehicle's stops are behind. With [atStop], it stands at the last of them. */
    val stopsPassed: Int = 0,
    val atStop: Boolean = false,
)

/** Minutes between now and a moment ahead, for use after "in". */
fun untilText(minutes: Double): String {
    val rounded = ceil(minutes).toInt()
    if (rounded <= 0) return "gleich"
    return "in ${formatDuration(rounded)}"
}

private fun String.capitalized() = replaceFirstChar { it.uppercase() }

fun journeyStart(journey: Journey): Int {
    val first = journey.l.firstOrNull()
    val walk = if (first?.isWalk == true) first.walkMinutes else 0
    return journey.vehicles.first().actualDeparture - walk
}

fun journeyEnd(journey: Journey): Int {
    val last = journey.l.lastOrNull()
    val walk = if (last?.isWalk == true) last.walkMinutes else 0
    return journey.vehicles.last().actualArrival + walk
}

private fun lineWithDirection(leg: Leg) = leg.h?.let { "${leg.n} Richtung $it" } ?: leg.n
private fun platformText(platform: String?) = platform?.let { ", Gleis $it" } ?: ""

/** Where in the stop list the vehicle is, derived from times rather than GPS. */
private fun locate(stops: List<TripStop>, now: Double): Pair<Int, Boolean> {
    var passed = 0
    stops.forEachIndexed { index, stop ->
        val arrival = stop.arrival ?: stop.departure
        val departure = stop.departure ?: stop.arrival
        if (arrival == null || departure == null) return@forEachIndexed
        if (now < arrival) return passed to false
        passed = index + 1
        if (now < departure) return passed to true
    }
    return passed to false
}

fun progressOf(journey: Journey, stopsByVehicle: List<List<TripStop>?>, now: Double): Progress {
    val legs = journey.vehicles
    val start = journeyStart(journey)
    val end = journeyEnd(journey)
    val share = if (end > start) ((now - start) / (end - start)).coerceIn(0.0, 1.0) else 0.0
    val first = legs.first()

    if (now < start) {
        val walks = journey.l.first().isWalk
        val soon = start - now <= 24 * 60
        val whenText = if (soon) untilText(start - now).capitalized() else "${formatDay(start)}, ${formatTime(start)}"
        return Progress(
            phase = Phase.Upcoming,
            vehicle = 0,
            share = share,
            headline = if (walks && soon) "$whenText losgehen" else whenText,
            detail = "${lineWithDirection(first)} ab ${first.f}${platformText(first.g)}",
        )
    }

    if (now < first.actualDeparture) {
        return Progress(
            phase = Phase.Approach,
            vehicle = 0,
            share = share,
            headline = "${first.n} fährt ${untilText(first.actualDeparture - now)}",
            detail = "Ab ${first.f}${platformText(first.g)}, ${formatTime(first.actualDeparture)} Uhr",
        )
    }

    legs.forEachIndexed { index, leg ->
        val arrival = leg.actualArrival
        if (now < arrival) {
            val stops = stopsByVehicle.getOrNull(index) ?: emptyList()
            val (passed, atStop) = locate(stops, now)
            val alight = "Ausstieg ${leg.t} ${untilText(arrival - now)}"
            if (atStop) {
                return Progress(
                    phase = Phase.Stopped, vehicle = index, share = share, stopsPassed = passed, atStop = true,
                    headline = "${leg.n} hält in ${stops.getOrNull(passed - 1)?.n ?: leg.f}",
                    detail = alight,
                )
            }
            val next = stops.getOrNull(passed)
            val nextArrival = next?.arrival
            val nextIsAlight = next == null || passed == stops.size - 1
            return Progress(
                phase = Phase.Riding, vehicle = index, share = share, stopsPassed = passed,
                headline = lineWithDirection(leg),
                detail = if (next?.n != null && nextArrival != null && !nextIsAlight) {
                    "Nächster Halt ${next.n} ${untilText(nextArrival - now)} · $alight"
                } else alight,
            )
        }
        val following = legs.getOrNull(index + 1)
        if (following != null && now < following.actualDeparture) {
            return Progress(
                phase = Phase.Transfer, vehicle = index + 1, share = share,
                headline = "Umstieg in ${leg.t}",
                detail = "${following.n} ab ${following.f}${platformText(following.g)}, ${untilText(following.actualDeparture - now)}",
            )
        }
    }

    val lastIndex = legs.size - 1
    val lastStops = stopsByVehicle.getOrNull(lastIndex)?.size ?: 0
    if (now < end) {
        return Progress(
            phase = Phase.FinalWalk, vehicle = lastIndex, share = share, stopsPassed = lastStops,
            headline = "Letztes Stück zu Fuß",
            detail = "Noch etwa ${formatDuration(ceil(end - now).toInt())}",
        )
    }
    return Progress(phase = Phase.Arrived, vehicle = lastIndex, share = 1.0, stopsPassed = lastStops, headline = "Angekommen")
}
