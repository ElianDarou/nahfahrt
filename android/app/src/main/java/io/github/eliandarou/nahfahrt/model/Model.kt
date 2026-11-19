package io.github.eliandarou.nahfahrt.model

import kotlinx.serialization.Serializable

/*
 * The backend's payloads and the app's stored records. Field names are the backend's short
 * ones and the same as the earlier web app stored, so its data can be taken over unchanged.
 * All times are minutes since the Unix epoch unless a name says otherwise.
 */

/**
 * One part of a journey. A walk has `m = "W"` and a duration `d`; every other mode is a vehicle
 * with the remaining fields. One class for both keeps the JSON exactly as the backend sends it.
 */
@Serializable
data class Leg(
    /** Mode: B bus, T tram, U subway, S suburban, R regional, F ferry, O other, W walk. */
    val m: String,
    /** Walk duration in minutes. */
    val d: Int? = null,
    /** Line name. */
    val n: String = "",
    /** Destination shown on the vehicle. */
    val h: String? = null,
    /** Boarding stop. */
    val f: String = "",
    /** Alighting stop. */
    val t: String = "",
    /** Scheduled departure. */
    val a: Int = 0,
    /** Scheduled arrival. */
    val b: Int = 0,
    /** Departure delay. */
    val x: Int? = null,
    /** Arrival delay. */
    val y: Int? = null,
    /** Boarding platform. */
    val g: String? = null,
    /** Alighting platform. */
    val k: String? = null,
    /** 1 when live data exists. */
    val r: Int? = null,
    /** 1 when cancelled. */
    val c: Int? = null,
    /** 1 for a rail replacement service. */
    val e: Int? = null,
    /** Disruption texts. */
    val w: List<String>? = null,
    /** Trip id, used to follow this vehicle live. */
    val i: String? = null,
) {
    val isWalk: Boolean get() = m == "W"
    val walkMinutes: Int get() = d ?: 0
    val live: Boolean get() = r == 1
    val cancelled: Boolean get() = c == 1
    val replacement: Boolean get() = e == 1
    val actualDeparture: Int get() = a + (x ?: 0)
    val actualArrival: Int get() = b + (y ?: 0)
}

@Serializable
data class Journey(
    /** Number of transfers. */
    val u: Int,
    val l: List<Leg>,
)

@Serializable
data class JourneysPayload(
    val j: List<Journey> = emptyList(),
    /** Cursor for earlier results. */
    val p: String? = null,
    /** Cursor for later results. */
    val n: String? = null,
    /** Walking the entire way takes this many minutes. */
    val w: Int? = null,
)

@Serializable
data class TripStop(
    val n: String? = null,
    /** Scheduled arrival. */
    val a: Int? = null,
    /** Scheduled departure. */
    val d: Int? = null,
    /** Arrival delay. */
    val x: Int? = null,
    /** Departure delay. */
    val y: Int? = null,
    /** Platform. */
    val g: String? = null,
    /** 1 when the platform differs from the schedule. */
    val p: Int? = null,
    /** 1 when the stop is cancelled. */
    val c: Int? = null,
    val la: Double? = null,
    val lo: Double? = null,
) {
    val arrival: Int? get() = a?.let { it + (x ?: 0) }
    val departure: Int? get() = d?.let { it + (y ?: 0) }
}

@Serializable
data class TripPayload(
    val s: List<TripStop> = emptyList(),
    val r: Int? = null,
    val c: Int? = null,
)

@Serializable
data class Place(
    /** Display name. */
    val n: String,
    /** Town, when the name does not already contain it. */
    val s: String? = null,
    /** Stop id. */
    val i: String? = null,
    /** Latitude. */
    val y: Double,
    /** Longitude. */
    val x: Double,
    /** 1 for addresses. */
    val a: Int? = null,
)

@Serializable
data class PlacesResponse(val r: List<Place> = emptyList())

@Serializable
data class ErrorResponse(val e: String? = null)

@Serializable
data class Station(
    val key: String,
    val name: String,
    val sub: String? = null,
    val id: String? = null,
    val lat: Double,
    val lon: Double,
    val addr: Boolean? = null,
    val count: Int = 0,
    /** Last use, milliseconds since the epoch. */
    val last: Long = 0,
    val fav: Boolean? = null,
    val label: String? = null,
    /** The current position: coordinates are fetched per search and never stored. */
    val me: Boolean? = null,
) {
    val isAddress: Boolean get() = addr == true
    val isFavourite: Boolean get() = fav == true
    val isMe: Boolean get() = me == true
    val displayName: String get() = label ?: name
    val displaySub: String?
        get() = when {
            label == null -> sub
            sub != null -> "$name, $sub"
            else -> name
        }

    companion object {
        val Location = Station(key = "me", name = "Mein Standort", lat = 0.0, lon = 0.0, addr = true, me = true)
    }
}

@Serializable
data class Route(val from: String, val to: String, val count: Int, val last: Long)

@Serializable
data class CachedJourneys(val from: String, val to: String, val savedAt: Long, val payload: JourneysPayload)

@Serializable
data class CachedPlaces(val q: String, val t: Long, val r: List<Place>)

@Serializable
data class SavedJourney(
    val key: String,
    val from: String,
    val to: String,
    val journey: Journey,
    /** Stops of each vehicle, once loaded. */
    val stops: List<List<TripStop>?> = emptyList(),
    /** When live data last arrived, milliseconds since the epoch. */
    val updatedAt: Long? = null,
    /** 1 when the user asked for reminders. */
    val bell: Int? = null,
) {
    val hasBell: Boolean get() = bell == 1
    fun stopsOf(vehicle: Int): List<TripStop>? = stops.getOrNull(vehicle)
}
