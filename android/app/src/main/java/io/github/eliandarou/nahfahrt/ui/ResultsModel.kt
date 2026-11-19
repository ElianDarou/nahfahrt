package io.github.eliandarou.nahfahrt.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.eliandarou.nahfahrt.data.Api
import io.github.eliandarou.nahfahrt.data.JourneyQuery
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.data.TripQuery
import io.github.eliandarou.nahfahrt.data.errorText
import io.github.eliandarou.nahfahrt.data.hasCoordinates
import io.github.eliandarou.nahfahrt.data.vehiclesToFollow
import io.github.eliandarou.nahfahrt.logic.journeyKey
import io.github.eliandarou.nahfahrt.logic.nowMinutes
import io.github.eliandarou.nahfahrt.logic.vehicles
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.JourneysPayload
import io.github.eliandarou.nahfahrt.model.Station
import io.github.eliandarou.nahfahrt.platform.Locator
import io.github.eliandarou.nahfahrt.platform.Network
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.plus
import kotlinx.coroutines.SupervisorJob

/** How many vehicles of a journey are worth loading ahead. */
private const val AHEAD = 2

/**
 * One search and its answers. It lives as long as the results screen is on the stack, so coming
 * back from the live view costs no new request.
 */
class ResultsModel(private val app: AppState, val from: Station, val to: Station, val plan: When) {
    private val scope = app.scope + SupervisorJob()
    private var request: Job? = null
    private val hasFilters = plan.filters.isNotEmpty()

    var journeys by mutableStateOf<List<Journey>>(emptyList())
        private set
    var earlier by mutableStateOf<String?>(null)
        private set
    var later by mutableStateOf<String?>(null)
        private set
    var walkOnly by mutableStateOf<Int?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var paging by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** Set while results from an earlier visit are shown, milliseconds since the epoch. */
    var savedAt by mutableStateOf<Long?>(null)
        private set
    var now by mutableStateOf(nowMinutes().toInt())
        private set
    /** The scroll position, kept while the live view lies on top. */
    val listState = LazyListState()

    init {
        val prefetched = Api.peekJourneys(query(plan.atMs ?: System.currentTimeMillis()))
        if (prefetched != null) {
            // The press on the search button already fetched it: no frame without results.
            apply(prefetched)
        } else {
            // Saved results appear at once and stay useful without network.
            if (plan.atMs == null && !hasFilters) {
                Store.loadJourneys(from, to)?.let { cached ->
                    val current = nowMinutes()
                    val upcoming = cached.payload.j.filter { it.vehicles.first().actualDeparture >= current }
                    if (upcoming.isNotEmpty()) {
                        journeys = upcoming
                        savedAt = cached.savedAt
                    }
                }
            }
            load(fresh = false)
        }
    }

    private fun query(atMs: Long, start: Station = from, destination: Station = to, cursor: String? = null) =
        JourneyQuery(start, destination, atMs, plan.arriveBy, cursor, plan.filters)

    private fun apply(payload: JourneysPayload) {
        journeys = payload.j
        earlier = payload.p
        later = payload.n
        walkOnly = payload.w
        savedAt = null
        if (plan.atMs == null && !hasFilters) Store.saveJourneys(from, to, payload)
    }

    /** With [fresh], as from the refresh button, an answer kept from this minute is not enough. */
    fun load(fresh: Boolean) {
        request?.cancel()
        loading = true
        error = null
        now = nowMinutes().toInt()
        val atMs = plan.atMs ?: System.currentTimeMillis()
        request = scope.launch {
            try {
                // "Mein Standort" gets its coordinates here, for this one request.
                val start = async { Locator.withPosition(app.context, from) }
                val destination = async { Locator.withPosition(app.context, to) }
                apply(Api.searchJourneys(query(atMs, start.await(), destination.await()), fresh))
                loading = false
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = errorText(failure)
                loading = false
            }
        }
    }

    fun page(laterOnes: Boolean) {
        val cursor = (if (laterOnes) later else earlier) ?: return
        if (paging) return
        paging = true
        error = null
        scope.launch {
            try {
                val start = Locator.withPosition(app.context, from)
                val destination = Locator.withPosition(app.context, to)
                val payload = Api.searchJourneys(query(plan.atMs ?: System.currentTimeMillis(), start, destination, cursor))
                val merged = (journeys + payload.j).distinctBy(::journeyKey)
                journeys = if (plan.filters["sort"] != null) merged else merged.sortedBy { it.vehicles.first().actualDeparture }
                if (laterOnes) later = payload.n else earlier = payload.p
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                error = errorText(failure)
            } finally {
                paging = false
            }
        }
    }

    /**
     * A card was opened, so the live view is one tap away. On Wi-Fi its stop lists are loaded now;
     * on mobile data nothing is fetched that may never be looked at.
     */
    fun prepareLive(journey: Journey) {
        if (!Network.unmetered(app.context)) return
        val saved = Saved.find(journeyKey(journey))
        val legs = journey.vehicles
        for (index in vehiclesToFollow(journey, nowMinutes()).take(AHEAD)) {
            val leg = legs[index]
            val id = leg.i ?: continue
            if (hasCoordinates(saved?.stopsOf(index))) continue
            Api.prefetchTrip(TripQuery(id, leg.a, leg.b, update = false))
        }
    }

    fun dispose() = scope.cancel()
}
