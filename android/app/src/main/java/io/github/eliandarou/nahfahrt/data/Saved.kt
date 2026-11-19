package io.github.eliandarou.nahfahrt.data

import io.github.eliandarou.nahfahrt.logic.journeyEnd
import io.github.eliandarou.nahfahrt.logic.journeyKey
import io.github.eliandarou.nahfahrt.logic.nowMinutes
import io.github.eliandarou.nahfahrt.logic.vehicles
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Leg
import io.github.eliandarou.nahfahrt.model.SavedJourney
import io.github.eliandarou.nahfahrt.model.TripPayload
import io.github.eliandarou.nahfahrt.model.TripStop
import kotlinx.serialization.builtins.ListSerializer

/** A finished journey stays this long, in case someone wants a last look. */
private const val EXPIRY_GRACE_MINUTES = 15
private const val MAX_SAVED = 30

fun isExpired(journey: Journey, nowMinutes: Double): Boolean = journeyEnd(journey) + EXPIRY_GRACE_MINUTES < nowMinutes

/** Connections the user keeps on the start page, with their live data. */
object Saved {
    const val KEY = "nf.saved.v1"
    private val serializer = ListSerializer(SavedJourney.serializer())
    private var cache: List<SavedJourney>? = null

    @Synchronized
    private fun readAll(): List<SavedJourney> = cache ?: (Files.read(KEY, serializer) ?: emptyList()).also { cache = it }

    @Synchronized
    private fun writeAll(entries: List<SavedJourney>) {
        cache = entries
        Files.write(KEY, serializer, entries)
    }

    @Synchronized
    fun reload() {
        cache = null
    }

    /** What is still current, soonest first; the rest is forgotten. */
    @Synchronized
    fun all(now: Double = nowMinutes()): List<SavedJourney> {
        val stored = readAll()
        val current = stored.filter { !isExpired(it.journey, now) }
        if (current.size != stored.size) writeAll(current)
        return current.sortedBy { journeyEnd(it.journey) }
    }

    fun find(key: String): SavedJourney? = all().firstOrNull { it.key == key }

    fun keys(): Set<String> = all().mapTo(HashSet()) { it.key }

    @Synchronized
    fun save(from: String, to: String, journey: Journey): SavedJourney {
        val entry = SavedJourney(
            key = journeyKey(journey),
            from = from,
            to = to,
            journey = journey,
            stops = journey.vehicles.map { null },
        )
        writeAll((all().filter { it.key != entry.key } + entry).takeLast(MAX_SAVED))
        return entry
    }

    @Synchronized
    fun remove(key: String) = writeAll(readAll().filter { it.key != key })

    @Synchronized
    fun store(entry: SavedJourney) = writeAll(readAll().map { if (it.key == entry.key) entry else it })
}

/** Carries live data of a vehicle's first and last stop over to its leg. */
private fun updateLeg(leg: Leg, stops: List<TripStop>, payload: TripPayload): Leg {
    val board = stops.firstOrNull()
    val alight = stops.lastOrNull()
    return leg.copy(
        x = board?.y?.takeIf { it != 0 },
        y = alight?.x?.takeIf { it != 0 },
        g = board?.g ?: leg.g,
        k = alight?.g ?: leg.k,
        r = if (payload.r == 1) 1 else null,
        c = if (payload.c == 1 || board?.c == 1 || alight?.c == 1) 1 else null,
    )
}

/**
 * Applies a trip response. Updates carry no names, so they need the stop list from an earlier
 * full response and return null when it no longer fits.
 */
fun applyTrip(
    entry: SavedJourney,
    vehicle: Int,
    payload: TripPayload,
    isUpdate: Boolean,
    nowMs: Long = System.currentTimeMillis(),
): SavedJourney? {
    var stops = payload.s
    if (isUpdate) {
        val known = entry.stopsOf(vehicle)
        if (known == null || known.size != payload.s.size) return null
        stops = known.mapIndexed { index, stop ->
            val fresh = payload.s[index]
            fresh.copy(n = fresh.n ?: stop.n, a = fresh.a ?: stop.a, d = fresh.d ?: stop.d, la = fresh.la ?: stop.la, lo = fresh.lo ?: stop.lo)
        }
    }
    var seen = -1
    val legs = entry.journey.l.map { leg ->
        if (leg.isWalk) return@map leg
        seen += 1
        if (seen == vehicle && stops.isNotEmpty()) updateLeg(leg, stops, payload) else leg
    }
    val count = maxOf(entry.journey.vehicles.size, entry.stops.size)
    val allStops = List(count) { index -> if (index == vehicle) stops else entry.stops.getOrNull(index) }
    return entry.copy(journey = entry.journey.copy(l = legs), stops = allStops, updatedAt = nowMs)
}

/** Stop lists saved by older versions lack the coordinates that position and actions need. */
fun hasCoordinates(stops: List<TripStop>?): Boolean = !stops.isNullOrEmpty() && stops.all { it.la != null }

/** Vehicles worth asking about: in use or starting within the next 90 minutes. */
fun vehiclesToFollow(journey: Journey, nowMinutes: Double): List<Int> =
    journey.vehicles.mapIndexedNotNull { index, leg ->
        if (leg.actualArrival > nowMinutes - 5 && leg.actualDeparture - nowMinutes <= 90 && leg.i != null) index else null
    }
