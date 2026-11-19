package io.github.eliandarou.nahfahrt.logic

import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.TripStop
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** A measured position. It lives in memory only; nothing writes it anywhere. */
data class Fix(val lat: Double, val lon: Double, val accuracy: Double, val atMs: Long)

data class Point(val lat: Double, val lon: Double)

/** Closer than this, someone counts as being at a stop. */
private const val AT_STOP_METRES = 150.0
/** Stops are joined by straight lines, while tracks bend: the tolerance has to allow for that. */
private const val ROUTE_TOLERANCE_METRES = 800.0
private const val ROUTE_TOLERANCE_SHARE = 0.3
private const val WALK_METRES_PER_MINUTE = 80.0
/** Streets are longer than the straight line that is all the app knows. */
private const val WALK_DETOUR = 1.25
/** Worse than this, a position says little about which stop someone is at. */
private const val WEAK_ACCURACY_METRES = 1000.0
/** Segments this close to the nearest count as equally likely; time then decides. */
private const val AMBIGUOUS_METRES = 300.0

private fun stopPoint(stop: TripStop?): Point? =
    if (stop?.la != null && stop.lo != null) Point(stop.la, stop.lo) else null

/** Flat-earth distance, which is plenty over the length of a walk or a stop distance. */
fun distanceMetres(left: Point, right: Point): Double {
    val metresPerLon = 111_320 * cos(Math.toRadians((left.lat + right.lat) / 2))
    return hypot((left.lat - right.lat) * 110_540, (left.lon - right.lon) * metresPerLon)
}

fun distanceMetres(fix: Fix, lat: Double, lon: Double) = distanceMetres(Point(fix.lat, fix.lon), Point(lat, lon))

private data class Projection(val fraction: Double, val distance: Double, val length: Double)

private fun project(point: Point, start: Point, end: Point): Projection {
    val metresPerLon = 111_320 * cos(Math.toRadians(start.lat))
    val x = (point.lon - start.lon) * metresPerLon
    val y = (point.lat - start.lat) * 110_540
    val dx = (end.lon - start.lon) * metresPerLon
    val dy = (end.lat - start.lat) * 110_540
    val squared = dx * dx + dy * dy
    val fraction = if (squared != 0.0) ((x * dx + y * dy) / squared).coerceIn(0.0, 1.0) else 0.0
    return Projection(fraction, hypot(x - fraction * dx, y - fraction * dy), sqrt(squared))
}

data class RouteMatch(
    val vehicle: Int,
    /** Stops behind, as in [Progress]. With [atStop], the last of them is where someone stands. */
    val stopsPassed: Int,
    val atStop: Boolean,
    /** Metres from the line between the stops. */
    val distance: Double,
    val onRoute: Boolean,
    /** Minutes later than the schedule at this spot; negative when ahead of it. */
    val behindSchedule: Int,
    val where: String,
)

private fun scheduledAtStop(stop: TripStop, now: Double): Double {
    val arrival = (stop.a ?: stop.d)?.toDouble() ?: now
    val departure = (stop.d ?: stop.a)?.toDouble() ?: now
    if (now < arrival) return now - arrival
    return if (now > departure) now - departure else 0.0
}

private data class Segment(val index: Int, val fraction: Double, val distance: Double, val length: Double, val scheduled: Double)

/** Finds the spot on one vehicle's stop list, using the time to tell apart a line's passes of one place. */
fun matchRoute(stops: List<TripStop>, vehicle: Int, fix: Fix, now: Double): RouteMatch? {
    val here = Point(fix.lat, fix.lon)
    val segments = stops.dropLast(1).mapIndexedNotNull { index, stop ->
        val start = stopPoint(stop) ?: return@mapIndexedNotNull null
        val end = stopPoint(stops[index + 1]) ?: return@mapIndexedNotNull null
        val leave = (stop.d ?: stop.a)?.toDouble() ?: now
        val reach = (stops[index + 1].a ?: stops[index + 1].d)?.toDouble() ?: now
        val p = project(here, start, end)
        Segment(index, p.fraction, p.distance, p.length, leave + p.fraction * (reach - leave))
    }
    if (segments.isEmpty()) return null

    val nearest = segments.minOf { it.distance }
    val best = segments.filter { it.distance <= nearest + AMBIGUOUS_METRES }.minBy { abs(it.scheduled - now) }

    val slack = min(fix.accuracy, 300.0)
    val onRoute = best.distance <= maxOf(ROUTE_TOLERANCE_METRES, best.length * ROUTE_TOLERANCE_SHARE) + slack
    val reach = AT_STOP_METRES + min(fix.accuracy, 100.0)
    val start = stops[best.index]
    val end = stops[best.index + 1]
    val nearStart = distanceMetres(here, stopPoint(start)!!) <= reach
    val nearEnd = distanceMetres(here, stopPoint(end)!!) <= reach
    val atStop = nearStart || nearEnd
    // Both stops in reach: the closer one it is.
    val stoppedAt = if (nearStart && (!nearEnd || best.fraction < 0.5)) best.index else best.index + 1

    return RouteMatch(
        vehicle = vehicle,
        stopsPassed = if (atStop) stoppedAt + 1 else best.index + 1,
        atStop = atStop,
        distance = best.distance,
        onRoute = onRoute,
        behindSchedule = jsRound(if (atStop) scheduledAtStop(stops[stoppedAt], now) else now - best.scheduled),
        where = if (atStop) "In ${stops[stoppedAt].n}" else "Zwischen ${start.n} und ${end.n}",
    )
}

/** Math.round as JavaScript does it: halves go up, also below zero. */
internal fun jsRound(value: Double): Int = kotlin.math.floor(value + 0.5).toInt()

/** The journey as if nothing were late, to answer "where should I be by now?". */
fun planned(journey: Journey, stopsByVehicle: List<List<TripStop>?>, now: Double): Progress {
    val onTime = journey.copy(l = journey.l.map { if (it.isWalk) it else it.copy(x = null, y = null) })
    val onTimeStops = stopsByVehicle.map { stops -> stops?.map { it.copy(x = null, y = null) } }
    return progressOf(onTime, onTimeStops, now)
}

private fun plannedText(journey: Journey, stopsByVehicle: List<List<TripStop>?>, plan: Progress): String {
    val leg = journey.vehicles[plan.vehicle]
    val stops = stopsByVehicle.getOrNull(plan.vehicle)
    return when (plan.phase) {
        Phase.Upcoming -> "Noch nicht unterwegs"
        Phase.Approach -> "An ${leg.f}, ${leg.n} fährt gleich"
        Phase.Transfer -> "Beim Umstieg in ${leg.f}"
        Phase.FinalWalk -> "Letztes Stück zu Fuß"
        Phase.Arrived -> "Schon angekommen"
        Phase.Stopped -> "In ${stops?.getOrNull(plan.stopsPassed - 1)?.n ?: leg.f}"
        Phase.Riding -> {
            val behind = stops?.getOrNull(plan.stopsPassed - 1)?.n
            val ahead = stops?.getOrNull(plan.stopsPassed)?.n
            if (behind != null && ahead != null) "Zwischen $behind und $ahead" else "Mit ${leg.n} unterwegs"
        }
    }
}

sealed interface Position {
    /** On the way to the stop of the next vehicle. */
    data class Walk(
        val stop: String,
        val metres: Int,
        val atStop: Boolean,
        val walkMinutes: Int,
        val minutesLeft: Int,
        val plan: String,
    ) : Position

    /** On a vehicle's route. */
    data class OnRoute(val match: RouteMatch, val plan: String, val progress: Progress) : Position

    /** Far from where the journey should be. */
    data class Off(val metres: Int, val plan: String) : Position

    data class Weak(val accuracy: Double) : Position
}

/** Compares a position with the journey. Null when the two have nothing to say to each other. */
fun describePosition(journey: Journey, stopsByVehicle: List<List<TripStop>?>, fix: Fix, now: Double): Position? {
    if (fix.accuracy > WEAK_ACCURACY_METRES) return Position.Weak(fix.accuracy)

    val progress = progressOf(journey, stopsByVehicle, now)
    val plan = planned(journey, stopsByVehicle, now)
    val planText = plannedText(journey, stopsByVehicle, plan)

    if (progress.phase == Phase.FinalWalk || progress.phase == Phase.Arrived) return null

    if (progress.phase == Phase.Riding || progress.phase == Phase.Stopped) {
        // Without live data the clock can run ahead of a late bus, so earlier vehicles count too.
        val found = (progress.vehicle downTo 0).mapNotNull { vehicle ->
            stopsByVehicle.getOrNull(vehicle)?.let { matchRoute(it, vehicle, fix, now) }
        }
        found.firstOrNull { it.onRoute }?.let { return Position.OnRoute(it, planText, progress) }
        return found.firstOrNull()?.let { Position.Off(it.distance.roundToInt(), planText) }
    }

    val stop = stopsByVehicle.getOrNull(progress.vehicle)?.firstOrNull()
    val point = stopPoint(stop) ?: return null
    val leg = journey.vehicles[progress.vehicle]
    val metres = distanceMetres(Point(fix.lat, fix.lon), point).roundToInt()
    return Position.Walk(
        stop = leg.f,
        metres = metres,
        atStop = metres <= AT_STOP_METRES + min(fix.accuracy, 100.0),
        walkMinutes = ceil(metres * WALK_DETOUR / WALK_METRES_PER_MINUTE).toInt(),
        minutesLeft = ceil(leg.actualDeparture - now).toInt(),
        plan = planText,
    )
}

fun scheduleText(behind: Int): String = when {
    abs(behind) <= 1 -> "Im Fahrplan"
    behind > 0 -> "$behind Min. hinter dem Fahrplan"
    else -> "${-behind} Min. vor dem Fahrplan"
}
