package io.github.eliandarou.nahfahrt.data

import io.github.eliandarou.nahfahrt.model.Leg
import io.github.eliandarou.nahfahrt.model.Place
import io.github.eliandarou.nahfahrt.model.Station
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlin.math.hypot

/** A stop someone pressed on, with whatever is known about it so far. */
data class StopRef(
    val name: String,
    val lat: Double? = null,
    val lon: Double? = null,
    /** The vehicle this stop belongs to, in case its coordinates have to be asked for. */
    val leg: Leg? = null,
    val end: End? = null,
    /** Already a full station, as in the search list. */
    val station: Station? = null,
) {
    enum class End { From, To }
}

private val separators = Regex("[^\\p{L}\\p{N}]+")
private fun normalizeName(text: String) = text.lowercase(Locale.GERMAN).replace(separators, " ").trim()

private fun metresBetween(place: Place, lat: Double, lon: Double) = hypot((place.y - lat) * 111_000, (place.x - lon) * 74_000)

/** The same stop under the same or a town-prefixed name, or else whatever stands right there. */
fun pickStop(places: List<Place>, name: String, lat: Double, lon: Double): Place? {
    val wanted = normalizeName(name)
    val byDistance = places.sortedBy { metresBetween(it, lat, lon) }
    val named = byDistance.firstOrNull {
        val candidate = normalizeName(it.n)
        candidate == wanted || candidate.endsWith(wanted) || wanted.endsWith(candidate)
    }
    if (named != null && metresBetween(named, lat, lon) < 400) return named
    return byDistance.firstOrNull()?.takeIf { metresBetween(it, lat, lon) < 100 }
}

/** Routable by its coordinates, for when the network cannot tell more about a stop. */
private fun stationFromCoordinates(name: String, lat: Double, lon: Double) =
    Station(key = String.format(Locale.ROOT, "%.4f,%.4f", lat, lon), name = name, lat = lat, lon = lon)

/**
 * Finds a stop's full entry at the moment someone asks: search responses stay small because
 * they don't carry ids and coordinates for every stop they mention.
 */
suspend fun resolveStop(ref: StopRef): Station {
    ref.station?.let { return it }
    Store.findKnownStation(ref.name, ref.lat, ref.lon)?.let { return it }

    var lat = ref.lat
    var lon = ref.lon
    val leg = ref.leg
    if ((lat == null || lon == null) && leg?.i != null && ref.end != null) {
        val stops = Api.followTrip(TripQuery(leg.i, leg.a, leg.b, update = false)).s
        val stop = if (ref.end == StopRef.End.From) stops.firstOrNull() else stops.lastOrNull()
        lat = stop?.la
        lon = stop?.lo
    }

    if (lat != null && lon != null) {
        try {
            pickStop(Api.nearbyStops(lat, lon), ref.name, lat, lon)?.let { return Store.stationFromPlace(it) }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Then the coordinates alone have to do.
        }
        return stationFromCoordinates(ref.name, lat, lon)
    }

    val wanted = normalizeName(ref.name)
    val places = Api.searchPlaces(ref.name, Store.regionHint())
    val match = places.firstOrNull { normalizeName(it.n) == wanted } ?: places.firstOrNull() ?: throw ApiError("unknown_place")
    return Store.stationFromPlace(match)
}
