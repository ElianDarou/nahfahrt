package io.github.eliandarou.nahfahrt.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.data.StopRef
import io.github.eliandarou.nahfahrt.logic.TransferRisk
import io.github.eliandarou.nahfahrt.logic.dayKey
import io.github.eliandarou.nahfahrt.logic.formatDay
import io.github.eliandarou.nahfahrt.logic.formatDuration
import io.github.eliandarou.nahfahrt.logic.formatTimeMs
import io.github.eliandarou.nahfahrt.logic.isCancelled
import io.github.eliandarou.nahfahrt.logic.journeyKey
import io.github.eliandarou.nahfahrt.logic.totalMinutes
import io.github.eliandarou.nahfahrt.logic.transferRisk
import io.github.eliandarou.nahfahrt.logic.transfers
import io.github.eliandarou.nahfahrt.logic.transfersText
import io.github.eliandarou.nahfahrt.logic.vehicles
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.platform.Reminders
import androidx.compose.ui.platform.LocalContext

/** Live data is not to be expected further ahead than this. */
private const val LIVE_HORIZON_MINUTES = 60

@Composable
fun ResultsScreen(app: AppState, model: ResultsModel) {
    val context = LocalContext.current
    val savedKeys = remember(app.revision) { Saved.keys() }
    val slow = rememberDelayed(model.loading)
    val from = model.from
    val to = model.to
    val plan = model.plan

    val toggleSave = { journey: Journey ->
        val key = journeyKey(journey)
        if (key in savedKeys) {
            Reminders.forget(context, key)
            app.showToast("Nicht mehr gemerkt")
        } else {
            Saved.save(from.displayName, to.displayName, journey)
            app.showToast("Gemerkt, du findest sie auf der Startseite")
        }
        app.changed()
    }
    val follow = { journey: Journey ->
        val key = journeyKey(journey)
        if (key !in savedKeys) Saved.save(from.displayName, to.displayName, journey)
        app.changed()
        app.openLive(key)
    }

    val baseLabel = plan.label ?: plan.atMs?.let {
        "${if (plan.arriveBy) "An" else "Ab"} ${formatDay(it / 60000.0)}, ${formatTimeMs(it)}"
    } ?: "Ab jetzt"
    val filterCount = plan.filters.keys.count { it !in setOf("df", "dt", "af", "al", "vs") }
    val requestLabel = if (filterCount > 0) "$baseLabel · ${if (filterCount == 1) "1 Filter" else "$filterCount Filter"}" else baseLabel

    Column(Modifier.fillMaxSize()) {
        AppBar(
            "${from.displayName} → ${to.displayName}",
            requestLabel,
            navigation = { IconBtn(Icons.Back, "Zurück", onClick = { app.back() }) },
        ) {
            Box(Modifier.heightIn(min = 48.dp).widthIn(min = 48.dp), contentAlignment = Alignment.Center) {
                if (slow) Spinner() else IconBtn(Icons.Refresh, "Aktualisieren", onClick = { model.load(fresh = true) }, enabled = !model.loading)
            }
        }

        LazyColumn(Modifier.fillMaxSize(), state = model.listState, contentPadding = ScreenPadding, verticalArrangement = Arrangement.spacedBy(10.dp)) {
            model.savedAt?.let { at ->
                item(key = "saved-at") {
                    BannerText("Gespeichert von ${formatTimeMs(at)} Uhr${if (model.loading) ", wird aktualisiert" else ""}. Verspätungen können sich geändert haben.")
                }
            }
            model.error?.let { text ->
                item(key = "error") {
                    Banner(bad = true) {
                        Text(text, style = Type.small)
                        TextBtn("Erneut versuchen", { model.load(fresh = true) })
                    }
                }
            }
            model.walkOnly?.let { item(key = "walk") { BannerText("Zu Fuß wärst du in $it Min. da.") } }

            if (model.earlier != null && model.journeys.isNotEmpty()) {
                item(key = "earlier") { PageButton("Frühere Verbindungen", !model.paging) { model.page(laterOnes = false) } }
            }

            if (!model.loading && model.error == null && model.journeys.isEmpty()) {
                item(key = "empty") {
                    Hint(
                        if (plan.filters.isNotEmpty()) "Keine Verbindung mit diesen Filtern gefunden. Lockere sie etwas."
                        else "Keine Verbindung mit dem Deutschlandticket gefunden.",
                    )
                }
            }
            if (model.loading && model.journeys.isEmpty() && model.error == null) {
                items(3) { Box(Modifier.fillMaxWidth().height(118.dp).alpha(0.6f).clip(MaterialTheme.shapes.large).background(colors.scheme.surfaceContainer)) }
            }

            var previousDay = when {
                plan.filters["df"] != null -> dayKey(plan.filters["df"]!!.toInt())
                plan.filters["al"] != null -> dayKey(plan.filters["al"]!!.toInt())
                plan.atMs != null -> dayKey(plan.atMs / 60000.0)
                else -> dayKey(model.now)
            }
            for (journey in model.journeys) {
                val key = journeyKey(journey)
                val departure = journey.vehicles.first().actualDeparture
                val day = dayKey(departure)
                if (day != previousDay) {
                    item(key = "day-$day") {
                        Text(
                            formatDay(departure),
                            color = colors.muted,
                            style = Type.small,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 4.dp, top = 8.dp),
                        )
                    }
                }
                previousDay = day
                item(key = key) {
                    JourneyCard(
                        journey = journey,
                        now = model.now,
                        saved = key in savedKeys,
                        onToggleSave = { toggleSave(journey) },
                        onFollow = { follow(journey) },
                        onShare = { app.openSheet(Sheet.Share(from.displayName, to.displayName, journey)) },
                        onStation = { app.openSheet(Sheet.StationActions(it)) },
                        onOpened = { model.prepareLive(journey) },
                    )
                }
            }

            if (model.later != null && model.journeys.isNotEmpty()) {
                item(key = "later") { PageButton("Spätere Verbindungen", !model.paging) { model.page(laterOnes = true) } }
            }
            if (model.journeys.isNotEmpty()) {
                item(key = "legal") {
                    Text(
                        "Der Deutschlandticket-Filter ist eine Näherung. Einzelne Ausnahmen, etwa IC-Strecken mit Ticketanerkennung, " +
                            "können fehlen. Prüfe die Gültigkeit im Zweifel vor der Fahrt.",
                        color = colors.muted,
                        style = Type.tiny,
                        modifier = Modifier.padding(top = 10.dp, start = 4.dp, end = 4.dp),
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun PageButton(text: String, enabled: Boolean, onClick: () -> Unit) {
    FilledTonalButton(onClick = onClick, enabled = enabled, shapes = ButtonDefaults.shapes(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        Text(text)
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun JourneyCard(
    journey: Journey,
    now: Int,
    saved: Boolean,
    onToggleSave: () -> Unit,
    onFollow: () -> Unit,
    onShare: () -> Unit,
    onStation: (StopRef) -> Unit,
    onOpened: () -> Unit,
) {
    var open by rememberSaveable(journeyKey(journey)) { mutableStateOf(false) }
    val legs = journey.vehicles
    val first = legs.first()
    val last = legs.last()
    val cancelled = isCancelled(journey)
    val risk = transferRisk(journey)
    val firstLeg = journey.l.first()
    val walkAtStart = if (firstLeg.isWalk && firstLeg.walkMinutes >= 10) firstLeg.walkMinutes else 0

    Card(
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = if (open) colors.scheme.surfaceContainerHigh else colors.scheme.surfaceContainer),
        // Opens in the next frame, without an expanding animation: the details are what was asked for.
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClickLabel = if (open) "Details schließen" else "Details zeigen") {
                        open = !open
                        if (open) onOpened()
                    }
                    .alpha(if (cancelled) 0.75f else 1f)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val big = TextStyle(fontSize = 19.sp, lineHeight = 24.sp)
                FlowRow(Modifier.padding(end = 40.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    TimeText(first.a, first.x, first.live, big, FontWeight.Bold)
                    Text("–", color = colors.muted, style = big, fontWeight = FontWeight.Bold)
                    TimeText(last.b, last.y, last.live, big, FontWeight.Bold)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (walkAtStart > 0) PlainChip("$walkAtStart Min. zu Fuß")
                    legs.forEach { LineChip(it) }
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "${formatDuration(totalMinutes(journey))} · ${transfersText(journey.u)} · ab ${first.f}${first.g?.let { ", Gl. $it" } ?: ""}",
                        color = colors.muted,
                        style = Type.small,
                        modifier = Modifier.weight(1f),
                    )
                    Icon(if (open) Icons.ChevronUp else Icons.ChevronDown, null, tint = colors.muted)
                }
                when {
                    cancelled -> Note("Fällt aus", Tone.Bad)
                    risk == TransferRisk.Broken -> Note("Anschluss nicht erreichbar", Tone.Bad)
                    risk == TransferRisk.Tight -> Note("Knapper Umstieg", Tone.Warn)
                }
            }
            IconBtn(
                if (saved) Icons.BookmarkFilled else Icons.Bookmark,
                if (saved) "Nicht mehr merken" else "Verbindung merken",
                onClick = onToggleSave,
                tint = if (saved) colors.accent else colors.text,
                modifier = Modifier.align(Alignment.TopEnd).padding(2.dp),
            )
        }
        if (open) {
            HorizontalDivider(color = colors.line, modifier = Modifier.padding(horizontal = 14.dp))
            Details(journey, now, onStation)
            Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, bottom = 6.dp), horizontalArrangement = Arrangement.End) {
                TextBtn("Teilen", onShare, icon = Icons.Share)
                TextBtn("Live verfolgen", onFollow)
            }
        }
    }
}

@Composable
private fun Details(journey: Journey, now: Int, onStation: (StopRef) -> Unit) {
    val list = transfers(journey)
    var vehicleIndex = -1
    Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 2.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        journey.l.forEachIndexed { index, leg ->
            if (leg.isWalk) {
                val next = journey.l.getOrNull(index + 1)
                val buffer = if (vehicleIndex >= 0 && next != null && !next.isWalk) list.getOrNull(vehicleIndex)?.minutes else null
                Text(
                    "Zu Fuß ${leg.walkMinutes} Min.${buffer?.let { " · $it Min. Umstiegszeit" } ?: ""}",
                    color = colors.muted,
                    style = Type.small,
                    modifier = Modifier.padding(start = 10.dp, top = if (index == 0) 10.dp else 0.dp),
                )
                return@forEachIndexed
            }
            vehicleIndex += 1
            val noLive = !leg.live && leg.actualDeparture - now < LIVE_HORIZON_MINUTES
            Column(Modifier.padding(top = 10.dp).alpha(if (leg.cancelled) 0.85f else 1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LineChip(leg)
                    leg.h?.let { Text("Richtung $it", color = colors.muted, style = Type.small) }
                }
                if (leg.replacement) Note("Ersatzverkehr")
                if (leg.cancelled) Note("Fällt aus", Tone.Bad)
                DetailStop(leg.a, leg.x, leg.live, leg.f, leg.g) { onStation(StopRef(leg.f, leg = leg, end = StopRef.End.From)) }
                DetailStop(leg.b, leg.y, leg.live, leg.t, leg.k) { onStation(StopRef(leg.t, leg = leg, end = StopRef.End.To)) }
                if (noLive) Note("Keine Live-Daten")
                leg.w?.forEach { Note(it, Tone.Bad) }
            }
        }
    }
}

@Composable
private fun DetailStop(scheduled: Int, delay: Int?, live: Boolean, name: String, platform: String?, onOpen: () -> Unit) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.widthIn(min = 48.dp)) { TimeText(scheduled, delay, live) }
        Text(
            name,
            style = Type.body,
            modifier = Modifier.weight(1f).clip(RoundedCornerShape(6.dp)).tapOrHold(onOpen, onOpen, "Aktionen für $name"),
        )
        platform?.let { Text("Gl. $it", color = colors.muted, style = Type.small, maxLines = 1) }
    }
}
