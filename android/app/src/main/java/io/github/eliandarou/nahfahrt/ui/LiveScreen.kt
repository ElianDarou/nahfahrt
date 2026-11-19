@file:OptIn(ExperimentalMaterial3ExpressiveApi::class)

package io.github.eliandarou.nahfahrt.ui

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearWavyProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import io.github.eliandarou.nahfahrt.data.Api
import io.github.eliandarou.nahfahrt.data.ApiError
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.data.StopRef
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.data.TripQuery
import io.github.eliandarou.nahfahrt.data.applyTrip
import io.github.eliandarou.nahfahrt.data.errorText
import io.github.eliandarou.nahfahrt.data.hasCoordinates
import io.github.eliandarou.nahfahrt.data.vehiclesToFollow
import io.github.eliandarou.nahfahrt.logic.Fix
import io.github.eliandarou.nahfahrt.logic.Phase
import io.github.eliandarou.nahfahrt.logic.Position
import io.github.eliandarou.nahfahrt.logic.TransferRisk
import io.github.eliandarou.nahfahrt.logic.describePosition
import io.github.eliandarou.nahfahrt.logic.formatDay
import io.github.eliandarou.nahfahrt.logic.formatDistance
import io.github.eliandarou.nahfahrt.logic.formatTime
import io.github.eliandarou.nahfahrt.logic.formatTimeMs
import io.github.eliandarou.nahfahrt.logic.journeyStart
import io.github.eliandarou.nahfahrt.logic.nowMinutes
import io.github.eliandarou.nahfahrt.logic.planned
import io.github.eliandarou.nahfahrt.logic.progressOf
import io.github.eliandarou.nahfahrt.logic.scheduleText
import io.github.eliandarou.nahfahrt.logic.transferRisk
import io.github.eliandarou.nahfahrt.logic.transfers
import io.github.eliandarou.nahfahrt.logic.vehicles
import io.github.eliandarou.nahfahrt.model.Leg
import io.github.eliandarou.nahfahrt.model.SavedJourney
import io.github.eliandarou.nahfahrt.model.TripStop
import io.github.eliandarou.nahfahrt.platform.Locator
import io.github.eliandarou.nahfahrt.platform.Reminders
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max

private const val POLL_MS = 60_000L
private const val CLOCK_MS = 15_000L
/** Earlier than this before leaving, a position says nothing about the journey. */
private const val GPS_HORIZON_MINUTES = 180
/** In a tunnel or deep inside a train the signal goes; an old position should say so. */
private const val STALE_FIX_MINUTES = 2.0

/** A saved connection with its live data; asks only about vehicles in use or coming up. */
private class LiveModel(private val context: Context, key: String) {
    var entry by mutableStateOf(Saved.find(key))
    var now by mutableDoubleStateOf(nowMinutes())
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    private var running = false

    suspend fun load(indexes: List<Int>) {
        val current = entry ?: return
        if (running) return
        running = true
        loading = true
        error = null
        try {
            var working = current
            val legs = current.journey.vehicles
            for (index in indexes) {
                val leg = legs.getOrNull(index) ?: continue
                val id = leg.i ?: continue
                suspend fun request(update: Boolean) = Api.followTrip(TripQuery(id, leg.a, leg.b, update))
                var updated = if (hasCoordinates(working.stopsOf(index))) applyTrip(working, index, request(true), true)
                else applyTrip(working, index, request(false), false)
                // The stop list changed, so ask once for all of it.
                if (updated == null) updated = applyTrip(working, index, request(false), false)
                if (updated != null) working = updated
            }
            // The bell can change while the answers are on their way.
            working = working.copy(bell = entry?.bell)
            entry = working
            Saved.store(working)
            Reminders.sync(context, working)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            // An old trip id only costs the extra stops, not the saved journey.
            if (!(failure is ApiError && failure.code == "unknown_trip")) error = errorText(failure)
        } finally {
            running = false
            loading = false
        }
    }

    suspend fun opening() {
        val current = entry ?: return
        // Stop lists are fetched once, on opening; afterwards only changes travel.
        val missing = current.journey.vehicles.indices.filter { !hasCoordinates(current.stopsOf(it)) }
        val indexes = (missing + vehiclesToFollow(current.journey, nowMinutes())).distinct()
        if (indexes.isNotEmpty()) load(indexes)
    }

    suspend fun follow() {
        val current = entry ?: return
        val indexes = vehiclesToFollow(current.journey, nowMinutes())
        if (indexes.isNotEmpty()) load(indexes)
    }

    suspend fun loadAll() {
        val current = entry ?: return
        load(current.journey.vehicles.indices.toList())
    }
}

@Composable
fun LiveScreen(app: AppState, key: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val model = remember(key) { LiveModel(context.applicationContext, key) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var gpsOn by remember { mutableStateOf(Store.liveGpsWanted()) }
    // Held in memory only: it is never part of the saved entry and leaves the phone in no request.
    var fix by remember { mutableStateOf<Fix?>(null) }
    var gpsError by remember { mutableStateOf<String?>(null) }
    var bellBusy by remember { mutableStateOf(false) }
    val slow = rememberDelayed(model.loading)

    LaunchedEffect(model) {
        launch { model.opening() }
        // Only while the app is in view: the clock, and every minute the latest delays.
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            model.now = nowMinutes()
            launch {
                while (true) {
                    delay(CLOCK_MS)
                    model.now = nowMinutes()
                }
            }
            launch {
                model.follow()
                while (true) {
                    delay(POLL_MS)
                    model.follow()
                }
            }
        }
    }

    val entry = model.entry
    if (entry == null) {
        Column(Modifier.fillMaxSize()) {
            AppBar("Abgelaufen", navigation = { IconBtn(Icons.Back, "Zurück", onClick = { app.back() }) })
            Hint("Diese Verbindung ist vorbei und wurde entfernt.")
        }
        return
    }

    val now = model.now
    val journey = entry.journey
    val start = journeyStart(journey)
    val progress = progressOf(journey, entry.stops, now)
    val gpsActive = gpsOn && progress.phase != Phase.Arrived && start - now <= GPS_HORIZON_MINUTES

    // The position is only followed in view, which also keeps the battery out of it.
    LaunchedEffect(gpsActive) {
        if (!gpsActive) {
            fix = null
            return@LaunchedEffect
        }
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            Locator.watch(context).collect { result ->
                result.onSuccess {
                    fix = it
                    gpsError = null
                }.onFailure { gpsError = errorText(it) }
            }
        }
    }

    val legs = journey.vehicles
    val list = transfers(journey)
    val risk = transferRisk(journey)
    val anyCancelled = legs.any { it.cancelled }
    val anyLive = legs.any { it.live }
    val arrived = progress.phase == Phase.Arrived
    val started = progress.phase != Phase.Upcoming
    val currentFix = fix
    val position = if (gpsActive && currentFix != null) describePosition(journey, entry.stops, currentFix, now) else null
    val gpsMatch = (position as? Position.OnRoute)?.match
    val plan = if (gpsMatch != null) planned(journey, entry.stops, now) else null

    Column(Modifier.fillMaxSize()) {
        AppBar(
            "${entry.from} → ${entry.to}",
            formatDay(start),
            navigation = { IconBtn(Icons.Back, "Zurück", onClick = { app.back() }) },
        ) {
            Box(Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp), contentAlignment = Alignment.Center) {
                if (slow) Spinner() else IconBtn(Icons.Refresh, "Aktualisieren", onClick = { scope.launch { model.loadAll() } }, enabled = !model.loading)
            }
        }

        LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            item(key = "status") {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 4.dp)
                        .clip(MaterialTheme.shapes.extraLarge)
                        .background(colors.scheme.primaryContainer)
                        .padding(18.dp)
                        .semantics { liveRegion = LiveRegionMode.Polite },
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val onContainer = colors.scheme.onPrimaryContainer
                    Text(progress.headline, style = MaterialTheme.typography.headlineSmall, color = onContainer)
                    progress.detail?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = onContainer) }
                    // The wavy line moves while the journey is under way and lies still before and after.
                    val moving = progress.phase != Phase.Upcoming && progress.phase != Phase.Arrived
                    LinearWavyProgressIndicator(
                        progress = { progress.share.toFloat() },
                        amplitude = { if (moving) 1f else 0f },
                        color = colors.scheme.primary,
                        trackColor = colors.scheme.onPrimaryContainer.copy(alpha = 0.18f),
                        modifier = Modifier
                            .padding(top = 8.dp)
                            .fillMaxWidth()
                            .semantics { contentDescription = "Fortschritt der Reise: ${(progress.share * 100).toInt()} Prozent" },
                    )
                    Row(Modifier.fillMaxWidth()) {
                        Text(formatTime(legs.first().actualDeparture), color = colors.scheme.onPrimaryContainer, style = Type.small)
                        Box(Modifier.weight(1f))
                        Text(formatTime(legs.last().actualArrival), color = colors.scheme.onPrimaryContainer, style = Type.small)
                    }
                    Text(
                        entry.updatedAt?.let {
                            "${if (anyLive) "Live-Daten" else "Fahrplan, noch keine Live-Daten"}, Stand ${formatTimeMs(it)} Uhr"
                        } ?: "Nach Fahrplan",
                        color = colors.scheme.onPrimaryContainer.copy(alpha = 0.8f),
                        style = Type.tiny,
                    )
                }
            }

            item(key = "actions") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    IconToggle("Standort", Icons.Location, gpsOn, {
                        Store.setLiveGpsWanted(!gpsOn)
                        gpsError = null
                        gpsOn = !gpsOn
                    }, Modifier.weight(1f))
                    IconToggle("Erinnerung", if (entry.hasBell) Icons.BellFilled else Icons.Bell, entry.hasBell, {
                        bellBusy = true
                        scope.launch {
                            val result = runCatching { Reminders.setBell(context, entry, !entry.hasBell) }.getOrNull()
                            if (result != null) model.entry = result.entry
                            app.showToast(result?.text ?: "Die Erinnerung ließ sich nicht einrichten.")
                            app.changed()
                            bellBusy = false
                        }
                    }, Modifier.weight(1f), enabled = !bellBusy)
                    FilledTonalIconButton(
                        onClick = { app.openSheet(Sheet.Share(entry.from, entry.to, journey)) },
                        shapes = IconButtonDefaults.shapes(),
                        modifier = Modifier.size(48.dp).semantics { contentDescription = "Teilen" },
                    ) { Icon(Icons.Share, null) }
                }
            }

            if (gpsActive) {
                item(key = "position") {
                    PositionCard(
                        position = position,
                        error = gpsError,
                        waiting = currentFix == null && gpsError == null,
                        age = currentFix?.let { max(0.0, now - it.atMs / 60000.0) } ?: 0.0,
                    )
                }
            }

            model.error?.let { item(key = "error") { BannerText("$it Angezeigt wird der letzte Stand.", bad = true) } }
            if (anyCancelled) {
                item(key = "cancelled") { BannerText("Ein Teil dieser Verbindung fällt aus. Suche am besten eine neue Verbindung.", bad = true) }
            } else if (risk == TransferRisk.Broken) {
                item(key = "broken") { BannerText("Durch die Verspätung ist ein Anschluss nicht mehr erreichbar.", bad = true) }
            }

            var vehicleIndex = -1
            journey.l.forEachIndexed { index, leg ->
                if (leg.isWalk) {
                    val next = journey.l.getOrNull(index + 1)
                    val transfer = if (vehicleIndex >= 0 && next != null && !next.isWalk) list.getOrNull(vehicleIndex) else null
                    item(key = "walk-$index") {
                        Row(Modifier.padding(horizontal = 14.dp)) {
                            Text(
                                "Zu Fuß ${leg.walkMinutes} Min.${transfer?.let { " · ${it.minutes} Min. Umstiegszeit" } ?: ""}",
                                color = colors.muted,
                                style = Type.small,
                            )
                            if (transfer != null && transfer.minutes < 5) {
                                Text(" · knapp", color = colors.warn, style = Type.small, fontWeight = FontWeight.SemiBold)
                            }
                        }
                    }
                    return@forEachIndexed
                }
                vehicleIndex += 1
                val current = vehicleIndex
                // A real position beats what the clock suggests.
                val isCurrent = if (gpsMatch != null) gpsMatch.vehicle == current
                else (progress.phase == Phase.Riding || progress.phase == Phase.Stopped) && progress.vehicle == current
                val finished = arrived || progress.phase == Phase.FinalWalk || (started && current < (gpsMatch?.vehicle ?: progress.vehicle))
                val plannedAt = plan?.takeIf { (it.phase == Phase.Riding || it.phase == Phase.Stopped) && it.vehicle == current }?.stopsPassed
                item(key = "vehicle-${leg.n}-${leg.a}") {
                    VehicleBlock(
                        leg = leg,
                        stops = entry.stopsOf(current),
                        isCurrent = isCurrent,
                        stopsPassed = if (isCurrent) gpsMatch?.stopsPassed ?: progress.stopsPassed else 0,
                        atStop = isCurrent && (gpsMatch?.atStop ?: progress.atStop),
                        finished = finished,
                        gps = gpsMatch != null,
                        plannedAt = plannedAt,
                        onStation = { app.openSheet(Sheet.StationActions(it)) },
                    )
                }
            }

            item(key = "legal") {
                Text(
                    (if (gpsOn) "Dein Standort wird nur hier auf dem Handy mit der Strecke verglichen und nicht gespeichert. " +
                        "Die Strecke ist eine gerade Linie zwischen den Halten, also eine Näherung."
                    else "Ohne Standort ist die Position aus Fahrplan und Live-Daten geschätzt.") +
                        " Die Verbindung verschwindet nach der Ankunft von selbst.",
                    color = colors.muted,
                    style = Type.tiny,
                    modifier = Modifier.padding(top = 10.dp, start = 4.dp, end = 4.dp),
                )
            }
            item(key = "forget") {
                PageButton("Nicht mehr merken", true) {
                    Reminders.forget(context, entry.key)
                    app.changed()
                    app.back()
                }
            }
        }
    }
}

@Composable
private fun PositionCard(position: Position?, error: String?, waiting: Boolean, age: Double) {
    @Composable
    fun note(text: String) = BannerText(text)
    when {
        error != null -> return note(error)
        waiting -> return note("Standort wird gesucht …")
        position == null -> return
    }
    when (position) {
        is Position.Weak -> note("Das GPS-Signal ist noch zu ungenau (etwa ${formatDistance(position.accuracy)}).")
        is Position.Walk -> {
            val short = position.walkMinutes - position.minutesLeft
            val warning = when {
                position.atStop || short <= 0 -> null
                short <= 2 -> "Das wird knapp"
                else -> "Zu Fuß reicht die Zeit wohl nicht"
            }
            PositionRows(
                you = if (position.atStop) "An ${position.stop}" else "Noch ${formatDistance(position.metres.toDouble())} bis ${position.stop} (Luftlinie)",
                small = if (!position.atStop) "Etwa ${position.walkMinutes} Min. zu Fuß, ${position.minutesLeft} Min. bis zur Abfahrt" else null,
                warning = warning,
                plan = position.plan,
            )
        }
        is Position.Off -> PositionRows("${formatDistance(position.metres.toDouble())} abseits der Strecke", "Bist du noch nicht eingestiegen?", null, position.plan)
        is Position.OnRoute -> {
            val match = position.match
            val stale = age >= STALE_FIX_MINUTES
            PositionRows(
                you = match.where,
                small = if (stale) "Letztes GPS-Signal vor ${floor(age).toInt()} Min." else null,
                warning = null,
                plan = position.plan,
                schedule = if (stale) null else scheduleText(match.behindSchedule) to (match.behindSchedule > 1),
            )
        }
    }
}

@Composable
private fun PositionRows(you: String, small: String?, warning: String?, plan: String, schedule: Pair<String, Boolean>? = null) {
    Column(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large).background(colors.scheme.surfaceContainer).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Du", color = colors.muted, style = Type.small, modifier = Modifier.width(64.dp))
            Column {
                Text(you, style = Type.body)
                small?.let { Text(it, color = colors.muted, style = Type.tiny) }
                schedule?.let { (text, late) -> Text(text, color = if (late) colors.late else colors.live, style = Type.tiny) }
                warning?.let { Text(it, color = colors.warn, style = Type.tiny, fontWeight = FontWeight.SemiBold) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Fahrplan", color = colors.muted, style = Type.small, modifier = Modifier.width(64.dp))
            Text(plan, style = Type.body)
        }
    }
}

private enum class StopState { Passed, Here, Next }

@Composable
private fun VehicleBlock(
    leg: Leg,
    stops: List<TripStop>?,
    isCurrent: Boolean,
    stopsPassed: Int,
    atStop: Boolean,
    finished: Boolean,
    gps: Boolean,
    plannedAt: Int?,
    onStation: (StopRef) -> Unit,
) {
    val shown = if (!stops.isNullOrEmpty()) stops else listOf(
        TripStop(n = leg.f, d = leg.a, y = leg.x, g = leg.g),
        TripStop(n = leg.t, a = leg.b, x = leg.y, g = leg.k),
    )
    var expanded by remember(leg.i, leg.a) { mutableStateOf(isCurrent) }
    LaunchedEffect(isCurrent) { if (isCurrent) expanded = true }
    val hidden = shown.size - 2
    fun stateOf(index: Int) = when {
        finished -> StopState.Passed
        !isCurrent -> StopState.Next
        atStop && index == stopsPassed - 1 -> StopState.Here
        index < stopsPassed -> StopState.Passed
        else -> StopState.Next
    }
    val showMarker = isCurrent && !atStop && stopsPassed > 0 && stopsPassed < shown.size

    Column(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large).background(colors.scheme.surfaceContainer).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LineChip(leg)
            leg.h?.let { Text("Richtung $it", color = colors.muted, style = Type.small) }
        }
        if (leg.replacement) Note("Ersatzverkehr")
        if (leg.cancelled) Note("Fällt aus", Tone.Bad)
        Column(Modifier.alpha(if (leg.cancelled) 0.6f else 1f)) {
            val rows = if (expanded) shown.indices.toList() else listOf(0, shown.size - 1)
            rows.forEachIndexed { position, index ->
                if (!expanded && position == 1 && hidden > 0) {
                    TextBtn(if (hidden == 1) "1 Zwischenhalt" else "$hidden Zwischenhalte", { expanded = true }, icon = Icons.ChevronDown)
                }
                if (expanded && showMarker && index == stopsPassed) HereMarker(if (gps) "Du bist hier" else "Du bist ungefähr hier", plan = false)
                if (expanded && plannedAt == index && !(showMarker && stopsPassed == plannedAt)) HereMarker("Laut Fahrplan hier", plan = true)
                val stop = shown[index]
                StopRow(
                    stop = stop,
                    state = stateOf(index),
                    live = leg.live,
                    first = index == 0,
                    last = index == shown.size - 1,
                ) {
                    onStation(
                        StopRef(
                            name = stop.n ?: "",
                            lat = stop.la,
                            lon = stop.lo,
                            leg = leg,
                            end = when (index) {
                                0 -> StopRef.End.From
                                shown.size - 1 -> StopRef.End.To
                                else -> null
                            },
                        ),
                    )
                }
            }
        }
        if (expanded && !isCurrent && hidden > 0) TextBtn("Zwischenhalte ausblenden", { expanded = false }, icon = Icons.ChevronUp)
        leg.w?.forEach { Note(it, Tone.Bad) }
    }
}

@Composable
private fun HereMarker(text: String, plan: Boolean) {
    Row(
        Modifier.padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.width(14.dp), contentAlignment = Alignment.Center) {
            Box(
                Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .then(if (plan) Modifier.border(2.dp, colors.muted, CircleShape) else Modifier.background(colors.accent)),
            )
        }
        Text(text, color = if (plan) colors.muted else colors.accent, style = Type.small, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun StopRow(stop: TripStop, state: StopState, live: Boolean, first: Boolean, last: Boolean, onOpen: () -> Unit) {
    val useArrival = last || stop.d == null
    val scheduled = if (useArrival) stop.a else stop.d
    val delay = (if (useArrival) stop.x else stop.y) ?: 0
    val line = colors.line
    val accent = colors.accent
    val muted = colors.muted
    val surface = colors.scheme.surfaceContainer
    val passed = state == StopState.Passed
    val textColor = if (passed) colors.muted else colors.text
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 30.dp)
            .tapOrHold(onOpen, onOpen, "Aktionen für ${stop.n ?: "Halt"}")
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            Modifier
                .width(14.dp)
                .heightIn(min = 22.dp)
                .drawBehind {
                    val x = size.width / 2
                    // The line runs through all stops of a vehicle, from the first dot to the last.
                    val top = if (first) size.height / 2 else -4.dp.toPx()
                    val bottom = if (last) size.height / 2 else size.height + 4.dp.toPx()
                    drawLine(line, Offset(x, top), Offset(x, bottom), strokeWidth = 2.dp.toPx())
                    val radius = 7.dp.toPx()
                    val center = Offset(x, size.height / 2)
                    if (state == StopState.Here) drawCircle(accent.copy(alpha = 0.3f), radius + 4.dp.toPx(), center)
                    // A filled dot for what is behind, a ring for what is still ahead.
                    drawCircle(if (passed || state == StopState.Here) accent else muted, radius, center)
                    if (!passed) drawCircle(surface, radius - 3.dp.toPx(), center)
                },
        )
        Row(Modifier.widthIn(min = 44.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (scheduled != null) {
                if (delay != 0) {
                    Text(formatTime(scheduled), color = colors.muted, textDecoration = TextDecoration.LineThrough, style = Type.body, fontWeight = FontWeight.Medium)
                }
                Text(
                    formatTime(scheduled + delay),
                    color = when {
                        delay > 0 -> colors.late
                        live -> colors.live
                        else -> textColor
                    },
                    style = Type.body,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                stop.n ?: "",
                color = textColor,
                style = Type.body,
                fontWeight = if (state == StopState.Here) FontWeight.Bold else FontWeight.Normal,
                textDecoration = if (stop.c == 1) TextDecoration.LineThrough else null,
            )
            if (stop.c == 1) Note("Halt entfällt", Tone.Bad)
        }
        stop.g?.let {
            Text(
                "Gl. $it${if (stop.p == 1) " (neu)" else ""}",
                color = if (stop.p == 1) colors.late else colors.muted,
                fontWeight = if (stop.p == 1) FontWeight.Bold else FontWeight.Normal,
                style = Type.small,
                maxLines = 1,
            )
        }
    }
}

