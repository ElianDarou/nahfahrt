package io.github.eliandarou.nahfahrt.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import io.github.eliandarou.nahfahrt.data.Api
import io.github.eliandarou.nahfahrt.data.StopRef
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.data.errorText
import io.github.eliandarou.nahfahrt.logic.byUsage
import io.github.eliandarou.nahfahrt.logic.distanceMetres
import io.github.eliandarou.nahfahrt.logic.formatDistance
import io.github.eliandarou.nahfahrt.logic.matches
import io.github.eliandarou.nahfahrt.model.Station
import io.github.eliandarou.nahfahrt.platform.Locator
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.round

private const val DEBOUNCE_MS = 250L
private const val MIN_REMOTE_CHARS = 2

private fun isSamePlace(left: Station, right: Station): Boolean {
    if (left.key == right.key || (left.id != null && left.id == right.id)) return true
    val metres = hypot((left.lat - right.lat) * 111_000, (left.lon - right.lon) * 74_000)
    return metres < 100 && left.isAddress == right.isAddress
}

private data class Nearby(val station: Station, val metres: Double)

@Composable
fun PickerScreen(app: AppState, title: String, stopsOnly: Boolean, onPick: (Station) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val usable = { station: Station -> !stopsOnly || (!station.isAddress && station.id != null) }

    var query by remember { mutableStateOf("") }
    var remote by remember { mutableStateOf(emptyList<Station>()) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var nearby by remember { mutableStateOf<List<Nearby>?>(null) }
    var locating by remember { mutableStateOf(false) }
    var nearbyError by remember { mutableStateOf<String?>(null) }
    var renaming by remember { mutableStateOf<Station?>(null) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { focus.requestFocus() }

    LaunchedEffect(query) {
        val text = query.trim()
        error = null
        if (text.length < MIN_REMOTE_CHARS) {
            remote = emptyList()
            loading = false
            return@LaunchedEffect
        }
        // An earlier answer for exactly this text: no request, no waiting.
        Store.cachedPlaces(text)?.let { known ->
            remote = known.map(Store::stationFromPlace)
            loading = false
            return@LaunchedEffect
        }
        // Meanwhile, what an earlier, shorter search found and still fits the text.
        val earlier = Store.cachedPlacesForPrefix(text)?.map(Store::stationFromPlace) ?: remote
        remote = earlier.filter { matches(text, it) }
        loading = true
        delay(DEBOUNCE_MS)
        try {
            val places = Api.searchPlaces(text, Store.regionHint())
            Store.storePlaces(text, places)
            remote = places.map(Store::stationFromPlace)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = errorText(failure)
        }
        loading = false
    }

    val typing = query.isNotBlank()
    val slow = rememberDelayed(loading)
    val stations = remember(app.revision) { Store.getStations() }
    val sorted = remember(stations, stopsOnly) { byUsage(stations).filter(usable) }
    val localMatches = remember(sorted, query) { sorted.filter { matches(query, it) } }
    val favourites = sorted.filter { it.isFavourite }
    val history = sorted.filter { !it.isFavourite && it.count > 0 }
    val others = remote.filter { station -> usable(station) && localMatches.none { isSamePlace(it, station) } }

    val hold = { station: Station -> app.openSheet(Sheet.StationActions(StopRef(station.name, station = station))) }
    val star = { station: Station ->
        Store.toggleFavourite(station)
        app.changed()
    }
    val pick = { station: Station ->
        keyboard?.hide()
        onPick(station)
    }
    val findNearby: () -> Unit = {
        scope.launch {
            locating = true
            nearbyError = null
            try {
                val fix = Locator.currentPosition(context)
                val places = Api.nearbyStops(round(fix.lat * 1e6) / 1e6, round(fix.lon * 1e6) / 1e6)
                val found = places.map(Store::stationFromPlace)
                    .map { Nearby(it, distanceMetres(fix, it.lat, it.lon)) }
                    .sortedBy { it.metres }
                nearby = found
                if (found.isEmpty()) nearbyError = "Keine Haltestelle in der Nähe gefunden."
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                nearbyError = errorText(failure)
            } finally {
                locating = false
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        AppBar(title, navigation = { IconBtn(Icons.Close, "Schließen", onClick = { app.back() }) })
        TextField(
            value = query,
            onValueChange = { query = it },
            singleLine = true,
            placeholder = { Text("Bahnhof, Haltestelle, Adresse") },
            leadingIcon = { Icon(Icons.Search, null) },
            trailingIcon = if (query.isNotEmpty()) ({ IconBtn(Icons.Close, "Eingabe löschen", onClick = { query = "" }) }) else null,
            shape = CircleShape,
            colors = TextFieldDefaults.colors(
                focusedContainerColor = colors.scheme.surfaceContainerHigh,
                unfocusedContainerColor = colors.scheme.surfaceContainerHigh,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
            ),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false, imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 12.dp)
                .heightIn(min = 56.dp)
                .focusRequester(focus)
                .semantics { contentDescription = "Bahnhof, Haltestelle oder Adresse suchen" },
        )

        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (!typing) {
                val top = buildList<Pair<String, @Composable () -> Unit>> {
                    if (!stopsOnly) add("me" to { ListRow(Icons.Location, "Mein Standort", "Genau, wird nicht gespeichert", { pick(Station.Location) }, iconTint = colors.accent) })
                    add("nearby" to {
                        ListRow(Icons.Nearby, "Haltestellen in der Nähe", null, findNearby, iconTint = colors.accent, enabled = !locating) {
                            if (locating) Spinner(28.dp, label = "Sucht")
                        }
                    })
                    nearby?.forEach { (station, metres) ->
                        add("near-${station.key}" to { StationRow(station, formatDistance(metres), { pick(station) }, { hold(station) }, { star(station) }) })
                    }
                }
                top.forEachIndexed { index, (key, row) -> item(key = key) { Segment(index, top.size) { row() } } }
                nearbyError?.let { item(key = "nearby-error") { Hint(it) } }

                if (favourites.isNotEmpty()) {
                    item(key = "fav-space") { Box(Modifier.padding(top = 14.dp)) }
                    rows(favourites, "fav") { station ->
                        StationRow(station, null, { pick(station) }, { hold(station) }, { star(station) }, onRename = { renaming = station })
                    }
                }
                if (history.isNotEmpty()) {
                    item(key = "history-head") {
                        SectionHead("Verlauf") {
                            IconBtn(Icons.Trash, "Verlauf löschen", onClick = {
                                Store.clearHistory()
                                app.changed()
                            })
                        }
                    }
                    rows(history, "history") { station ->
                        StationRow(station, null, { pick(station) }, { hold(station) }, { star(station) }, onRemove = {
                            Store.removeFromHistory(station)
                            app.changed()
                        })
                    }
                }
                if (favourites.isEmpty() && history.isEmpty()) {
                    item(key = "hint") {
                        Hint("Stationen, die du nutzt, erscheinen hier und beim Tippen sofort ganz oben. Lang drücken öffnet mehr Aktionen.")
                    }
                }
            } else {
                rows(localMatches, "local") { station ->
                    StationRow(
                        station, null, { pick(station) }, { hold(station) }, { star(station) },
                        onRename = if (station.isFavourite) ({ renaming = station }) else null,
                    )
                }
                if (others.isNotEmpty() || slow) {
                    item(key = "others-head") {
                        SectionHead("Weitere Ergebnisse") { if (slow) Box(Modifier.padding(end = 12.dp)) { Spinner(28.dp) } }
                    }
                }
                rows(others, "remote") { station ->
                    StationRow(station, null, { pick(station) }, { hold(station) }, { star(station) })
                }
                error?.let { item(key = "error") { Hint(it) } }
                if (!loading && error == null && localMatches.isEmpty() && others.isEmpty() && query.trim().length >= MIN_REMOTE_CHARS) {
                    item(key = "nothing") { Hint("Nichts gefunden.") }
                }
            }
            item(key = "end") { Box(Modifier.padding(bottom = 24.dp)) }
        }
    }

    renaming?.let { station ->
        RenameDialog(station, onDismiss = { renaming = null }) { label ->
            Store.renameStation(station, label)
            renaming = null
            app.changed()
        }
    }
}

private fun LazyListScope.rows(list: List<Station>, prefix: String, row: @Composable (Station) -> Unit) {
    list.forEachIndexed { index, station ->
        item(key = "$prefix-${station.key}") { Segment(index, list.size) { row(station) } }
    }
}

/** One tile of an expressive segmented list. */
@Composable
private fun Segment(index: Int, count: Int, content: @Composable () -> Unit) {
    Surface(shape = segmentShape(index, count), color = colors.surface, modifier = Modifier.fillMaxWidth()) { content() }
}

@Composable
private fun SectionHead(text: String, trailing: @Composable () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 16.dp, end = 4.dp, top = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text, style = MaterialTheme.typography.titleSmall, color = colors.accent, modifier = Modifier.semantics { heading() })
        trailing()
    }
}

@Composable
private fun StationRow(
    station: Station,
    note: String?,
    onPick: () -> Unit,
    onHold: () -> Unit,
    onStar: () -> Unit,
    onRename: (() -> Unit)? = null,
    onRemove: (() -> Unit)? = null,
) {
    val sub = listOfNotNull(note, station.displaySub).joinToString(" · ")
    ListRow(if (station.isAddress) Icons.Address else Icons.Stop, station.displayName, sub, onPick, onHold = onHold) {
        if (onRename != null) IconBtn(Icons.Pencil, "Umbenennen", onClick = onRename)
        if (onRemove != null) IconBtn(Icons.Close, "Aus dem Verlauf entfernen", onClick = onRemove)
        IconBtn(
            if (station.isFavourite) Icons.StarFilled else Icons.Star,
            if (station.isFavourite) "Favorit entfernen" else "Als Favorit speichern",
            onClick = onStar,
            tint = if (station.isFavourite) colors.star else colors.text,
        )
    }
}

@Composable
private fun RenameDialog(station: Station, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var label by remember { mutableStateOf(station.label ?: "") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Pencil, null) },
        title = { Text("Favorit benennen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(station.name, color = colors.muted)
                OutlinedTextField(
                    value = label,
                    onValueChange = { if (it.length <= 30) label = it },
                    singleLine = true,
                    label = { Text("Name") },
                    placeholder = { Text("z. B. Arbeit") },
                    shape = MaterialTheme.shapes.large,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { onSave(label) }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus),
                )
            }
        },
        confirmButton = { TextBtn("Speichern", { onSave(label) }) },
        dismissButton = { TextBtn("Abbrechen", onDismiss) },
    )
}
