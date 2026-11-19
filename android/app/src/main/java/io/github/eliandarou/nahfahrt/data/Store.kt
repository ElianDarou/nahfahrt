package io.github.eliandarou.nahfahrt.data

import io.github.eliandarou.nahfahrt.logic.byUsage
import io.github.eliandarou.nahfahrt.logic.usageScore
import io.github.eliandarou.nahfahrt.model.CachedJourneys
import io.github.eliandarou.nahfahrt.model.CachedPlaces
import io.github.eliandarou.nahfahrt.model.JourneysPayload
import io.github.eliandarou.nahfahrt.model.Place
import io.github.eliandarou.nahfahrt.model.Route
import io.github.eliandarou.nahfahrt.model.Station
import kotlinx.serialization.builtins.ListSerializer
import java.util.Locale
import kotlin.math.hypot

/** Stations, routes and cached answers on the device. Everything here is held in memory once read. */
object Store {
    const val STATIONS = "nf.stations.v1"
    const val ROUTES = "nf.routes.v1"
    const val JOURNEYS = "nf.journeys.v1"
    const val PLACES = "nf.places.v1"
    const val LIVE_GPS = "nf.liveGps.v1"
    const val LAST = "nf.last.v1"
    const val PREFETCH = "nf.prefetch.v1"

    private const val MAX_STATIONS = 200
    private const val MAX_ROUTES = 30
    private const val MAX_CACHED_JOURNEYS = 10
    private const val MAX_CACHED_PLACES = 80
    private const val PLACES_MAX_AGE_MS = 30 * 86_400_000L

    private val stationList = ListSerializer(Station.serializer())
    private val routeList = ListSerializer(Route.serializer())
    private val journeyList = ListSerializer(CachedJourneys.serializer())
    private val placeList = ListSerializer(CachedPlaces.serializer())

    private var stations: List<Station>? = null
    private var routes: List<Route>? = null
    private var journeys: List<CachedJourneys>? = null
    private var places: LinkedHashMap<String, CachedPlaces>? = null

    /** Reads what the start page needs, off the main thread while the window comes up. */
    fun preload() {
        getStations()
        getRoutes()
    }

    /** Drops the memory copies, after a migration replaced the files. */
    @Synchronized
    fun reload() {
        stations = null
        routes = null
        journeys = null
        places = null
    }

    // Stations

    /** Coordinates stay stable when upstream datasets rename their stop ids. */
    private fun placeKey(place: Place) = String.format(Locale.ROOT, "%.4f,%.4f", place.y, place.x)

    fun stationFromPlace(place: Place): Station {
        val isAddress = place.a == 1
        return Station(
            key = placeKey(place),
            // "Musterstraße 1" alone says little in a list or a results title.
            name = if (isAddress && place.s != null) "${place.s}, ${place.n}" else place.n,
            sub = if (isAddress) null else place.s,
            id = place.i,
            lat = place.y,
            lon = place.x,
            addr = isAddress,
        )
    }

    @Synchronized
    fun getStations(): List<Station> =
        stations ?: (Files.read(STATIONS, stationList) ?: emptyList()).also { stations = it }

    @Synchronized
    private fun saveStations(list: List<Station>) {
        val kept = byUsage(list).take(MAX_STATIONS)
        stations = kept
        Files.write(STATIONS, stationList, kept)
    }

    @Synchronized
    private fun upsert(station: Station, change: (Station) -> Station): Station {
        if (station.isMe) return station
        val list = getStations().toMutableList()
        val index = list.indexOfFirst { it.key == station.key }
        val known = if (index >= 0) list[index] else station
        // Ids and names from a fresh search replace older ones.
        val updated = change(known.copy(name = station.name, sub = station.sub, id = station.id ?: known.id))
        if (index >= 0) list[index] = updated else list += updated
        saveStations(list)
        return updated
    }

    /**
     * Both ends of a search in one write. Sorting and encoding the station list used to happen
     * twice, right before the results screen opened; once is enough.
     */
    @Synchronized
    fun recordSearchUse(from: Station, to: Station): Pair<Station, Station> {
        val now = System.currentTimeMillis()
        val list = getStations().toMutableList()
        fun bump(station: Station): Station {
            if (station.isMe) return station
            val index = list.indexOfFirst { it.key == station.key }
            val known = if (index >= 0) list[index] else station
            val updated = known.copy(
                name = station.name,
                sub = station.sub,
                id = station.id ?: known.id,
                count = known.count + 1,
                last = now,
            )
            if (index >= 0) list[index] = updated else list += updated
            return updated
        }
        val usedFrom = bump(from)
        val usedTo = bump(to)
        saveStations(list)
        recordRoute(usedFrom, usedTo)
        return usedFrom to usedTo
    }

    fun recordStationUse(station: Station): Station =
        upsert(station) { it.copy(count = it.count + 1, last = System.currentTimeMillis()) }

    fun toggleFavourite(station: Station): Station =
        upsert(station) {
            it.copy(fav = !it.isFavourite, last = if (it.last != 0L) it.last else System.currentTimeMillis())
        }

    fun renameStation(station: Station, label: String): Station =
        upsert(station) { it.copy(label = label.trim().ifEmpty { null }) }

    @Synchronized
    fun removeFromHistory(station: Station) {
        val list = getStations()
        saveStations(
            if (station.isFavourite) list.map { if (it.key == station.key) it.copy(count = 0, last = 0) else it }
            else list.filter { it.key != station.key },
        )
    }

    /** Clears the history; favourites stay. */
    @Synchronized
    fun clearHistory() = saveStations(getStations().filter { it.isFavourite }.map { it.copy(count = 0, last = 0) })

    fun isFavourite(key: String): Boolean = getStations().any { it.key == key && it.isFavourite }

    /** What a place from the backend, or a stop of a trip, is already known as. */
    fun findKnownStation(name: String, lat: Double?, lon: Double?): Station? {
        val named = getStations().filter { it.name == name }
        if (lat == null || lon == null) return named.singleOrNull()
        return named.firstOrNull { hypot((it.lat - lat) * 111_000, (it.lon - lon) * 74_000) < 500 }
    }

    /** The most used station stands in for the user's region, without any location permission. */
    fun regionHint(): String? {
        val now = System.currentTimeMillis()
        val top = getStations().filter { it.count > 0 }.maxByOrNull { usageScore(it.count, it.last, now) }
        return top?.let { String.format(Locale.ROOT, "%.2f,%.2f", it.lat, it.lon) }
    }

    // Routes

    @Synchronized
    fun getRoutes(): List<Route> = routes ?: (Files.read(ROUTES, routeList) ?: emptyList()).also { routes = it }

    @Synchronized
    private fun saveRoutes(list: List<Route>) {
        routes = list
        Files.write(ROUTES, routeList, list)
    }

    private fun topRoutesOf(list: List<Route>): List<Route> {
        val now = System.currentTimeMillis()
        return list.sortedByDescending { usageScore(it.count, it.last, now) }
    }

    @Synchronized
    fun recordRoute(from: Station, to: Station) {
        if (from.isMe || to.isMe) return
        val now = System.currentTimeMillis()
        val list = getRoutes().toMutableList()
        val index = list.indexOfFirst { it.from == from.key && it.to == to.key }
        if (index >= 0) list[index] = list[index].copy(count = list[index].count + 1, last = now)
        else list += Route(from.key, to.key, 1, now)
        saveRoutes(topRoutesOf(list).take(MAX_ROUTES))
    }

    data class KnownRoute(val route: Route, val from: Station, val to: Station)

    fun topRoutes(limit: Int): List<KnownRoute> {
        val byKey = getStations().associateBy { it.key }
        return topRoutesOf(getRoutes()).mapNotNull { route ->
            val from = byKey[route.from]
            val to = byKey[route.to]
            if (from != null && to != null) KnownRoute(route, from, to) else null
        }.take(limit)
    }

    @Synchronized
    fun removeRoute(route: Route) = saveRoutes(getRoutes().filter { it.from != route.from || it.to != route.to })

    // Results kept for offline use

    @Synchronized
    private fun cachedJourneys(): List<CachedJourneys> =
        journeys ?: (Files.read(JOURNEYS, journeyList) ?: emptyList()).also { journeys = it }

    @Synchronized
    fun saveJourneys(from: Station, to: Station, payload: JourneysPayload) {
        if (from.isMe || to.isMe) return
        val others = cachedJourneys().filter { it.from != from.key || it.to != to.key }
        val list = (listOf(CachedJourneys(from.key, to.key, System.currentTimeMillis(), payload)) + others)
            .take(MAX_CACHED_JOURNEYS)
        journeys = list
        Files.write(JOURNEYS, journeyList, list)
    }

    fun loadJourneys(from: Station, to: Station): CachedJourneys? {
        if (from.isMe || to.isMe) return null
        return cachedJourneys().firstOrNull { it.from == from.key && it.to == to.key }
    }

    // Place searches

    @Synchronized
    private fun placeEntries(): LinkedHashMap<String, CachedPlaces> =
        places ?: run {
            val now = System.currentTimeMillis()
            val map = LinkedHashMap<String, CachedPlaces>()
            (Files.read(PLACES, placeList) ?: emptyList())
                .filter { now - it.t < PLACES_MAX_AGE_MS }
                .forEach { map[it.q] = it }
            map
        }.also { places = it }

    private fun placeQuery(text: String) = text.trim().lowercase(Locale.GERMAN)
    private val digit = Regex("\\d")

    /**
     * Answers of earlier searches. Stop searches stay on the device for a month, so a repeated
     * search needs no request; searches with digits (addresses) only for this session.
     */
    @Synchronized
    fun cachedPlaces(text: String): List<Place>? = placeEntries()[placeQuery(text)]?.r

    /** The answer for the longest earlier search that the text starts with, if any. */
    @Synchronized
    fun cachedPlacesForPrefix(text: String): List<Place>? {
        val query = placeQuery(text)
        return placeEntries().values
            .filter { it.q.length >= 2 && query.startsWith(it.q) }
            .maxByOrNull { it.q.length }?.r
    }

    @Synchronized
    fun storePlaces(text: String, found: List<Place>) {
        val query = placeQuery(text)
        val entries = placeEntries()
        entries.remove(query)
        entries[query] = CachedPlaces(query, System.currentTimeMillis(), found)
        if (digit.containsMatchIn(query)) return
        val kept = entries.values.filter { !digit.containsMatchIn(it.q) }.takeLast(MAX_CACHED_PLACES)
        Files.write(PLACES, placeList, kept)
    }

    // The last search's start and destination, so the start page opens where it was left.

    @kotlinx.serialization.Serializable
    data class LastSearch(val from: Station? = null, val to: Station? = null)

    fun lastSearch(): LastSearch = Files.read(LAST, LastSearch.serializer()) ?: LastSearch()

    /** "Mein Standort" is kept as the choice only; it never carries coordinates. */
    fun setLastSearch(from: Station?, to: Station?) {
        fun kept(station: Station?) = if (station?.isMe == true) Station.Location else station
        Files.write(LAST, LastSearch.serializer(), LastSearch(kept(from), kept(to)))
    }

    /** When the route in the form was last loaded ahead at start, in milliseconds; 0 when never. */
    fun lastPrefetchAt(): Long = Files.readRaw(PREFETCH)?.toLongOrNull() ?: 0L

    fun setLastPrefetchAt(at: Long) = Files.writeRaw(PREFETCH, at.toString())

    // The live position switch: this yes or no is all that is stored about location.

    fun liveGpsWanted(): Boolean = Files.readRaw(LIVE_GPS)?.trim() == "\"1\"" || Files.readRaw(LIVE_GPS)?.trim() == "1"

    fun setLiveGpsWanted(wanted: Boolean) = if (wanted) Files.writeRaw(LIVE_GPS, "1") else Files.remove(LIVE_GPS)
}
