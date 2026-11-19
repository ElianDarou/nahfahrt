package io.github.eliandarou.nahfahrt.ui

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import io.github.eliandarou.nahfahrt.data.Api
import io.github.eliandarou.nahfahrt.data.JourneyQuery
import io.github.eliandarou.nahfahrt.data.StopRef
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.logic.FilterState
import io.github.eliandarou.nahfahrt.logic.toQuery
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Station
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

enum class PickTarget { From, To, Via }

sealed interface Screen {
    data object Home : Screen
    data class Pick(val target: PickTarget) : Screen
    data object Results : Screen
    data class Live(val key: String) : Screen
}

sealed interface Sheet {
    data class StationActions(val stop: StopRef) : Sheet
    data class Share(val from: String, val to: String, val journey: Journey) : Sheet
}

enum class WhenMode { Now, Departure, Arrival }

/** What a search asks for besides start and destination. */
data class When(
    /** Milliseconds since the epoch; null means "now". */
    val atMs: Long? = null,
    val arriveBy: Boolean = false,
    val filters: Map<String, String> = emptyMap(),
    /** Replaces the requested time in the header. */
    val label: String? = null,
)

/** Everything the screens share. One instance per activity; state survives rotation through configChanges. */
class AppState(val context: Context, val scope: CoroutineScope) {
    var stack by mutableStateOf(listOf<Screen>(Screen.Home))
        private set
    var sheet by mutableStateOf<Sheet?>(null)
        private set

    private val last = Store.lastSearch()
    var from by mutableStateOf(last.from)
    var to by mutableStateOf(last.to)
    var whenMode by mutableStateOf(WhenMode.Now)
    var dateTime by mutableStateOf(LocalDateTime.now().truncatedTo(ChronoUnit.MINUTES))
    var filters by mutableStateOf(FilterState())
    var advancedOpen by mutableStateOf(false)

    var results by mutableStateOf<ResultsModel?>(null)
        private set

    var toast by mutableStateOf<String?>(null)
        private set
    private var toastJob: Job? = null

    /** Bumped whenever stored stations, routes or saved connections change. */
    var revision by mutableIntStateOf(0)
        private set

    val screen: Screen get() = stack.last()

    fun changed() {
        revision += 1
    }

    fun open(next: Screen) {
        stack = stack + next
    }

    /** Closes a sheet first, then walks back through the screens. False when there is nothing left. */
    fun back(): Boolean {
        if (sheet != null) {
            sheet = null
            return true
        }
        if (stack.size <= 1) return false
        val leaving = stack.last()
        stack = stack.dropLast(1)
        if (leaving == Screen.Results && Screen.Results !in stack) {
            results?.dispose()
            results = null
        }
        return true
    }

    fun goHome() {
        sheet = null
        results?.dispose()
        results = null
        stack = listOf(Screen.Home)
    }

    fun openSheet(next: Sheet) {
        sheet = next
    }

    fun closeSheet() {
        sheet = null
    }

    fun showToast(text: String) {
        toast = text
        toastJob?.cancel()
        toastJob = scope.launch {
            delay(4000)
            toast = null
        }
    }

    fun openLive(key: String) {
        // From a reminder, the live view of that journey opens on top of whatever is there.
        if (screen == Screen.Live(key)) return
        sheet = null
        open(Screen.Live(key))
    }

    fun buildWhen(): When {
        val query = filters.toQuery()
        if (filters.hasTimeWindow) return When(System.currentTimeMillis(), false, query, filters.windowLabel)
        return when (whenMode) {
            WhenMode.Now -> When(null, false, query)
            else -> When(
                dateTime.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli(),
                whenMode == WhenMode.Arrival,
                query,
            )
        }
    }

    val canSearch: Boolean
        get() {
            val start = from
            val destination = to
            return start != null && destination != null && start.key != destination.key && filters.problem == null
        }

    /** Starts the request while the finger is still on the button; the tap then joins it. */
    fun prefetch(start: Station?, destination: Station?, plan: When) {
        if (start == null || destination == null || start.key == destination.key) return
        Api.prefetchJourneys(
            JourneyQuery(start, destination, plan.atMs ?: System.currentTimeMillis(), plan.arriveBy, null, plan.filters),
        )
    }

    fun startSearch(start: Station, destination: Station, plan: When) {
        advancedOpen = false
        val usedStart = Store.recordStationUse(start)
        val usedDestination = Store.recordStationUse(destination)
        Store.recordRoute(usedStart, usedDestination)
        from = usedStart
        to = usedDestination
        Store.setLastSearch(usedStart, usedDestination)
        changed()
        results?.dispose()
        results = ResultsModel(this, usedStart, usedDestination, plan)
        open(Screen.Results)
    }
}
