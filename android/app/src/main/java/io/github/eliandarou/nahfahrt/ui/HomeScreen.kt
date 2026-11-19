@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)

package io.github.eliandarou.nahfahrt.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LargeFlexibleTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.ripple
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.logic.Phase
import io.github.eliandarou.nahfahrt.logic.formatDay
import io.github.eliandarou.nahfahrt.logic.formatTime
import io.github.eliandarou.nahfahrt.logic.journeyStart
import io.github.eliandarou.nahfahrt.logic.nowMinutes
import io.github.eliandarou.nahfahrt.logic.progressOf
import io.github.eliandarou.nahfahrt.logic.vehicles
import io.github.eliandarou.nahfahrt.model.Station
import io.github.eliandarou.nahfahrt.platform.Reminders
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val SOURCES_URL = "https://transitous.org/sources/"
private const val OSM_URL = "https://www.openstreetmap.org/copyright"
private const val REPO_URL = "https://github.com/ElianDarou/nahfahrt"
private val dateTimeFormat = DateTimeFormatter.ofPattern("EEE, d. MMM yyyy, HH:mm 'Uhr'", Locale.GERMANY)

@Composable
private fun Field(label: String, station: Station?, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = MaterialTheme.shapes.large,
        color = colors.scheme.surfaceContainerHighest,
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp).semantics { contentDescription = "$label: ${station?.displayName ?: "nicht gewählt"}" },
    ) {
        Column(Modifier.padding(start = 16.dp, end = 64.dp, top = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.Center) {
            Text(label, color = colors.muted, style = MaterialTheme.typography.labelMedium)
            if (station != null) {
                Text(station.displayName, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            } else {
                Text("Bahnhof, Haltestelle, Adresse", color = colors.muted, style = Type.body)
            }
        }
    }
}

@Composable
fun HomeScreen(app: AppState) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var clock by remember { mutableDoubleStateOf(nowMinutes()) }
    var picking by remember { mutableStateOf(false) }
    // Keeps the status of saved connections current without any network use.
    LaunchedEffect(Unit) {
        while (true) {
            clock = nowMinutes()
            delay(30_000)
        }
    }
    val revision = app.revision
    val saved = remember(revision, clock) { Saved.all(clock) }
    val routes = remember(revision) { Store.topRoutes(5) }
    val from = app.from
    val to = app.to
    val sameStation = from != null && to != null && from.key == to.key
    val problem = app.filters.problem
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    // The request leaves when the finger touches the button, a good 100 ms before the tap counts.
    val searchPress = remember { MutableInteractionSource() }
    LaunchedEffect(searchPress) {
        searchPress.interactions.collect { interaction ->
            if (interaction is PressInteraction.Press && app.canSearch) app.prefetch(app.from, app.to, app.buildWhen())
        }
    }

    Column(Modifier.fillMaxSize().nestedScroll(scroll.nestedScrollConnection)) {
        LargeFlexibleTopAppBar(
            title = { Text("Nahfahrt", fontWeight = FontWeight.Bold) },
            subtitle = { Text("Nahverkehr mit dem Deutschlandticket") },
            scrollBehavior = scroll,
            windowInsets = WindowInsets(0, 0, 0, 0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.bg, scrolledContainerColor = colors.bg),
        )
        LazyColumn(Modifier.fillMaxSize(), contentPadding = ScreenPadding) {
            item(key = "search") {
                Card(
                    shape = MaterialTheme.shapes.extraLarge,
                    colors = CardDefaults.cardColors(containerColor = colors.scheme.surfaceContainer),
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box {
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Field("Start", from) { app.open(Screen.Pick(PickTarget.From)) }
                                Field("Ziel", to) { app.open(Screen.Pick(PickTarget.To)) }
                            }
                            FilledTonalIconButton(
                                onClick = {
                                    app.from = to
                                    app.to = from
                                },
                                shapes = IconButtonDefaults.shapes(),
                                modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp)
                                    .semantics { contentDescription = "Start und Ziel tauschen" },
                            ) { Icon(Icons.Swap, null) }
                        }

                        Segments(
                            options = listOf(WhenMode.Now.name to "Jetzt", WhenMode.Departure.name to "Abfahrt", WhenMode.Arrival.name to "Ankunft"),
                            selected = app.whenMode.name,
                            onSelect = { app.whenMode = WhenMode.valueOf(it) },
                        )

                        if (app.whenMode != WhenMode.Now) {
                            Surface(
                                onClick = { picking = true },
                                shape = MaterialTheme.shapes.large,
                                color = colors.scheme.surfaceContainerHighest,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                            ) {
                                Box(Modifier.padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
                                    Text(dateTimeFormat.format(app.dateTime), style = MaterialTheme.typography.titleMedium)
                                }
                            }
                        }

                        AdvancedSearch(app)

                        PrimaryButton(
                            "Verbindungen suchen",
                            onClick = {
                                val start = app.from
                                val destination = app.to
                                if (start != null && destination != null) app.startSearch(start, destination, app.buildWhen())
                            },
                            enabled = app.canSearch,
                            modifier = Modifier.fillMaxWidth(),
                            interactionSource = searchPress,
                        )
                        if (sameStation) Note("Start und Ziel sind gleich.", Tone.Warn)
                        if (problem != null) Note(problem, Tone.Warn)
                    }
                }
            }

            if (saved.isNotEmpty()) {
                item(key = "saved-head") { Heading("Gemerkte Verbindungen") }
                item(key = "saved") {
                    Group {
                        saved.forEach { entry ->
                            item {
                                val state = progressOf(entry.journey, entry.stops, clock)
                                val legs = entry.journey.vehicles
                                ListItem(
                                    headlineContent = { Text("${entry.from} → ${entry.to}", fontWeight = FontWeight.SemiBold) },
                                    supportingContent = {
                                        Column {
                                            Text("${formatDay(journeyStart(entry.journey))}, ${formatTime(legs.first().actualDeparture)}–${formatTime(legs.last().actualArrival)}")
                                            Text(
                                                state.headline,
                                                color = if (state.phase != Phase.Upcoming) colors.live else colors.muted,
                                                fontWeight = FontWeight.SemiBold,
                                            )
                                        }
                                    },
                                    trailingContent = {
                                        androidx.compose.foundation.layout.Row {
                                            IconBtn(
                                                if (entry.hasBell) Icons.BellFilled else Icons.Bell,
                                                if (entry.hasBell) "Erinnerung ausschalten" else "Erinnerung einschalten",
                                                tint = if (entry.hasBell) colors.accent else colors.muted,
                                                onClick = {
                                                    scope.launch {
                                                        val result = runCatching { Reminders.setBell(context, entry, !entry.hasBell) }
                                                        app.showToast(result.getOrNull()?.text ?: "Die Erinnerung ließ sich nicht einrichten.")
                                                        app.changed()
                                                    }
                                                },
                                            )
                                            IconBtn(Icons.Close, "Nicht mehr merken", tint = colors.muted, onClick = {
                                                Reminders.forget(context, entry.key)
                                                app.changed()
                                            })
                                        }
                                    },
                                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                                    modifier = Modifier.clickable { app.openLive(entry.key) },
                                )
                            }
                        }
                    }
                }
            }

            if (routes.isNotEmpty()) {
                item(key = "routes-head") { Heading("Deine Strecken") }
                item(key = "routes") {
                    Group { routes.forEach { known -> item { RouteRow(app, known) } } }
                }
            }

            item(key = "legal") {
                val link = TextLinkStyles(SpanStyle(color = colors.accent, textDecoration = TextDecoration.Underline))
                Column(Modifier.padding(top = 24.dp, start = 16.dp, end = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Nur Nahverkehr: Bus, Tram, U-Bahn, S-Bahn, Regionalzug.", color = colors.muted, style = Type.tiny)
                    Text(
                        buildAnnotatedString {
                            append("Daten: ")
                            withLink(LinkAnnotation.Url(SOURCES_URL, link)) { append("Transitous und Quellen") }
                            append(", Karte und Wege © ")
                            withLink(LinkAnnotation.Url(OSM_URL, link)) { append("OpenStreetMap-Mitwirkende") }
                            append(".")
                        },
                        color = colors.muted,
                        style = Type.tiny,
                    )
                    Text(
                        buildAnnotatedString {
                            withLink(LinkAnnotation.Url(REPO_URL, link)) { append("Open Source auf GitHub") }
                            append(". Kein Angebot der Deutschen Bahn.")
                        },
                        color = colors.muted,
                        style = Type.tiny,
                    )
                }
            }
        }
    }

    if (picking) {
        DateTimeDialog(app.dateTime, onDismiss = { picking = false }) {
            app.dateTime = it
            picking = false
        }
    }
}

@Composable
private fun RouteRow(app: AppState, known: Store.KnownRoute) {
    val press = remember { MutableInteractionSource() }
    LaunchedEffect(press) {
        press.interactions.collect { if (it is PressInteraction.Press) app.prefetch(known.from, known.to, When()) }
    }
    val sub = listOfNotNull(known.from.displaySub, known.to.displaySub).joinToString(" → ")
    ListItem(
        headlineContent = { Text("${known.from.displayName} → ${known.to.displayName}", fontWeight = FontWeight.SemiBold) },
        supportingContent = if (sub.isNotEmpty()) ({ Text(sub) }) else null,
        trailingContent = {
            IconBtn(Icons.Close, "Strecke entfernen", tint = colors.muted, onClick = {
                Store.removeRoute(known.route)
                app.changed()
            })
        },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clickable(press, ripple()) { app.startSearch(known.from, known.to, When()) },
    )
}
