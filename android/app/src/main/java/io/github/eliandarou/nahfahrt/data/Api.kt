package io.github.eliandarou.nahfahrt.data

import io.github.eliandarou.nahfahrt.BuildConfig
import io.github.eliandarou.nahfahrt.model.ErrorResponse
import io.github.eliandarou.nahfahrt.model.JourneysPayload
import io.github.eliandarou.nahfahrt.model.Place
import io.github.eliandarou.nahfahrt.model.PlacesResponse
import io.github.eliandarou.nahfahrt.model.Station
import io.github.eliandarou.nahfahrt.model.TripPayload
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import kotlin.coroutines.cancellation.CancellationException

class ApiError(val code: String) : Exception(code)

data class JourneyQuery(
    val from: Station,
    val to: Station,
    /** Requested time, milliseconds since the epoch. */
    val atMs: Long,
    val arriveBy: Boolean = false,
    val cursor: String? = null,
    val filters: Map<String, String> = emptyMap(),
) {
    /** A search from the current position carries it, so it is never shared or kept. */
    val private: Boolean get() = from.isMe || to.isMe
}

data class TripQuery(val id: String, val boardAt: Int, val alightAt: Int, val update: Boolean)

/**
 * The app's only connection to the outside: the Nahfahrt backend. Plain HttpURLConnection,
 * which Android already ships, with gzip and keep-alive; nothing is cached on disk.
 */
object Api {
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 20_000

    /** Shared requests run here, so a caller that leaves does not cancel them for the others. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The server rounds the requested time to the minute, so its answers hold for that long. */
    private val journeys = RequestCache<JourneysPayload>(scope, 60_000)
    /** Stop lists of a trip; updates of a running vehicle are never kept. */
    private val trips = RequestCache<TripPayload>(scope, 45_000)

    private fun encode(query: Map<String, String>) =
        query.entries.joinToString("&") { (key, value) -> "$key=${URLEncoder.encode(value, "UTF-8")}" }

    private fun stableKey(query: Map<String, String>) = query.toSortedMap().entries.joinToString("&")

    private suspend fun <T> get(path: String, query: Map<String, String>, serializer: KSerializer<T>): T =
        withContext(Dispatchers.IO) {
            val connection = URL("${BuildConfig.API_URL}$path?${encode(query)}").openConnection() as HttpURLConnection
            // Leaving the coroutine closes the socket instead of waiting out the timeout.
            val handle = currentCoroutineContext()[Job]?.invokeOnCompletion { cause ->
                if (cause is CancellationException) connection.disconnect()
            }
            try {
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.useCaches = false
                val status = try {
                    connection.responseCode
                } catch (error: SocketTimeoutException) {
                    throw ApiError("timeout")
                } catch (error: IOException) {
                    throw ApiError("offline")
                }
                val body = try {
                    (if (status in 200..299) connection.inputStream else connection.errorStream)
                        ?.bufferedReader()?.use { it.readText() } ?: ""
                } catch (error: SocketTimeoutException) {
                    throw ApiError("timeout")
                } catch (error: IOException) {
                    throw ApiError("offline")
                }
                if (status !in 200..299) {
                    val code = runCatching { AppJson.decodeFromString(ErrorResponse.serializer(), body).e }.getOrNull()
                    throw ApiError(code ?: "upstream")
                }
                try {
                    AppJson.decodeFromString(serializer, body)
                } catch (error: Exception) {
                    throw ApiError("upstream")
                }
            } finally {
                handle?.dispose()
            }
        }

    /**
     * Opens the connection to the backend while the start page is on screen. DNS, TCP and TLS
     * then lie behind the first search instead of in front of it. Costs a few hundred bytes.
     */
    fun warmUp() {
        scope.launch {
            runCatching {
                val connection = URL("${BuildConfig.API_URL}/v1/journeys").openConnection() as HttpURLConnection
                connection.requestMethod = "OPTIONS"
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.inputStream.use { it.readBytes() }
            }
        }
    }

    suspend fun searchPlaces(text: String, near: String?): List<Place> {
        val query = buildMap {
            put("q", text)
            near?.let { put("near", it) }
        }
        return get("/v1/places", query, PlacesResponse.serializer()).r
    }

    /** Stops around a position. Never kept, as the position is part of the address. */
    suspend fun nearbyStops(lat: Double, lon: Double): List<Place> =
        get("/v1/nearby", mapOf("at" to coordinates(lat, lon)), PlacesResponse.serializer()).r

    private fun coordinates(lat: Double, lon: Double) = "${trim(lat)},${trim(lon)}"
    /** As JavaScript writes numbers: no trailing zeros, so the keys match the web app's. */
    private fun trim(value: Double): String =
        if (value == Math.floor(value)) value.toLong().toString() else value.toBigDecimal().stripTrailingZeros().toPlainString()

    private fun coordinates(station: Station) = coordinates(station.lat, station.lon)

    private fun journeyParams(query: JourneyQuery): Map<String, String> {
        val params = LinkedHashMap(query.filters)
        params["from"] = query.from.id ?: coordinates(query.from)
        params["to"] = query.to.id ?: coordinates(query.to)
        params["at"] = Instant.ofEpochMilli(query.atMs / 60_000 * 60_000).toString().let {
            // JavaScript's toISOString always writes milliseconds.
            if (it.length == 20) it.dropLast(1) + ".000Z" else it
        }
        if (query.from.id != null) params["fromLL"] = coordinates(query.from)
        if (query.to.id != null) params["toLL"] = coordinates(query.to)
        if (query.from.isAddress) params["fromType"] = "addr"
        if (query.to.isAddress) params["toType"] = "addr"
        if (query.arriveBy) params["arrive"] = "1"
        query.cursor?.let { params["cursor"] = it }
        if (query.private) params["priv"] = "1"
        return params
    }

    /**
     * A search. With [fresh] (the refresh button), an answer kept from earlier in this minute is
     * not good enough: delays change.
     */
    suspend fun searchJourneys(query: JourneyQuery, fresh: Boolean = false): JourneysPayload {
        val params = journeyParams(query)
        if (query.private) return get("/v1/journeys", params, JourneysPayload.serializer())
        return journeys.run(stableKey(params), fresh) { get("/v1/journeys", params, JourneysPayload.serializer()) }.await()
    }

    /**
     * Starts a search a moment before it is asked for: when a finger comes down on the search
     * button. The tap then joins this request instead of sending its own; a press that turns
     * out not to be a tap costs one request. Position searches and pages are never started early.
     */
    fun prefetchJourneys(query: JourneyQuery) {
        if (query.private || query.cursor != null) return
        val params = journeyParams(query)
        journeys.run(stableKey(params)) { get("/v1/journeys", params, JourneysPayload.serializer()) }
    }

    /** An answer that is ready right now, for a screen that must not wait a frame. */
    fun peekJourneys(query: JourneyQuery): JourneysPayload? =
        if (query.private) null else journeys.get(stableKey(journeyParams(query)))

    private fun tripParams(trip: TripQuery) = buildMap {
        put("id", trip.id)
        put("a", trip.boardAt.toString())
        put("b", trip.alightAt.toString())
        if (trip.update) put("u", "1")
    }

    suspend fun followTrip(trip: TripQuery): TripPayload {
        val params = tripParams(trip)
        if (trip.update) return get("/v1/trip", params, TripPayload.serializer())
        return trips.run(stableKey(params)) { get("/v1/trip", params, TripPayload.serializer()) }.await()
    }

    /** Loads the stops of a vehicle the live view is likely to open next. */
    fun prefetchTrip(trip: TripQuery) {
        val params = tripParams(trip)
        trips.run(stableKey(params)) { get("/v1/trip", params, TripPayload.serializer()) }
    }
}

fun errorText(error: Throwable?): String = when ((error as? ApiError)?.code ?: "upstream") {
    "offline" -> "Keine Internetverbindung."
    "timeout" -> "Das Netz ist gerade zu langsam. Bitte versuche es noch einmal."
    "daily_limit" -> "Das Tageslimit des kostenlosen Datendienstes ist erreicht. Morgen geht es weiter."
    "location_denied" -> "Der Standort ist für Nahfahrt nicht freigegeben. Du kannst ihn in den Android-Einstellungen erlauben."
    "location_off" -> "Dein Standort ist gerade nicht verfügbar. Ist er am Handy eingeschaltet?"
    "location_timeout" -> "Dein Standort konnte nicht bestimmt werden. Versuche es draußen noch einmal."
    "unknown_place" -> "Diese Haltestelle ist nicht mehr bekannt. Bitte suche sie neu."
    else -> "Der Datendienst ist gerade nicht erreichbar. Bitte versuche es gleich noch einmal."
}
