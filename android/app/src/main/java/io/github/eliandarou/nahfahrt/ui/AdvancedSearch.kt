@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package io.github.eliandarou.nahfahrt.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.eliandarou.nahfahrt.logic.FilterState
import io.github.eliandarou.nahfahrt.logic.todayInput
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private val SORTS = listOf("" to "Abfahrt", "fast" to "Schnellste", "few" to "Umstiege")
private val MODE_LABELS = listOf("B" to "Bus", "T" to "Tram", "U" to "U-Bahn", "S" to "S-Bahn", "R" to "Regionalzug", "F" to "Fähre")
private val dayFormat = DateTimeFormatter.ofPattern("EEE, d. MMMM yyyy", Locale.GERMANY)

@Composable
private fun Label(text: String) = Text(text, color = colors.muted, style = MaterialTheme.typography.labelLarge)

/** Material's exposed dropdown: a read-only field that opens its options below. */
@Composable
private fun Choice(label: String, value: String, options: List<Pair<String, String>>, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = modifier) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == value }?.second ?: value,
            onValueChange = {},
            readOnly = true,
            singleLine = true,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            shape = MaterialTheme.shapes.large,
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (option, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    leadingIcon = if (option == value) ({ Icon(Icons.Check, null) }) else null,
                    onClick = {
                        open = false
                        onChange(option)
                    },
                    contentPadding = ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
        }
    }
}

@Composable
private fun TimeRange(label: String, from: String, to: String, onChange: (String, String) -> Unit) {
    var editing by remember { mutableStateOf<Int?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Label(label)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { editing = 0 }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f)) {
                Text(from.ifEmpty { "von" }, color = if (from.isEmpty()) colors.muted else colors.text)
            }
            Text("bis", color = colors.muted)
            OutlinedButton(onClick = { editing = 1 }, shapes = ButtonDefaults.shapes(), modifier = Modifier.weight(1f)) {
                Text(to.ifEmpty { "bis" }, color = if (to.isEmpty()) colors.muted else colors.text)
            }
            if (from.isNotEmpty() || to.isNotEmpty()) IconBtn(Icons.Close, "$label löschen", onClick = { onChange("", "") }, size = 44.dp)
        }
    }
    editing?.let { which ->
        val current = runCatching { LocalTime.parse(if (which == 0) from else to) }.getOrNull() ?: LocalTime.now()
        TimeDialog(current, "$label ${if (which == 0) "von" else "bis"}", onDismiss = { editing = null }) { time ->
            val text = String.format(Locale.ROOT, "%02d:%02d", time.hour, time.minute)
            if (which == 0) onChange(text, to) else onChange(from, text)
            editing = null
        }
    }
}

@Composable
fun AdvancedSearch(app: AppState) {
    val filters = app.filters
    fun set(change: FilterState) {
        app.filters = change
    }
    val count = filters.activeCount
    var pickingDay by remember { mutableStateOf(false) }

    Column {
        ListItem(
            headlineContent = { Text("Erweiterte Suche", style = MaterialTheme.typography.titleSmall) },
            supportingContent = if (count > 0) ({ Text(if (count == 1) "1 Filter aktiv" else "$count Filter aktiv") }) else null,
            leadingContent = if (count > 0) ({ Badge { Text(count.toString()) } }) else null,
            trailingContent = { Icon(if (app.advancedOpen) Icons.ChevronUp else Icons.ChevronDown, null) },
            colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            modifier = Modifier.clickable { app.advancedOpen = !app.advancedOpen },
        )

        AnimatedVisibility(app.advancedOpen) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label("Reihenfolge")
                    Segments(SORTS, filters.sort, { set(filters.copy(sort = it)) })
                }

                TimeRange("Abfahrt zwischen", filters.departFrom, filters.departTo) { from, to ->
                    set(filters.copy(departFrom = from, departTo = to))
                }
                TimeRange("Ankunft zwischen", filters.arriveFrom, filters.arriveTo) { from, to ->
                    set(filters.copy(arriveFrom = from, arriveTo = to))
                }
                if (filters.windowStarted) {
                    val day = LocalDate.parse(filters.date.ifEmpty { todayInput() })
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Label("Tag der Zeitfenster")
                        OutlinedButton(onClick = { pickingDay = true }, shapes = ButtonDefaults.shapes(), modifier = Modifier.fillMaxWidth()) {
                            Text(dayFormat.format(day))
                        }
                    }
                    if (pickingDay) {
                        DateDialog(day, onDismiss = { pickingDay = false }) {
                            set(filters.copy(date = it.toString()))
                            pickingDay = false
                        }
                    }
                }
                if (filters.hasTimeWindow) Note("Das Zeitfenster ersetzt den Zeitpunkt oben.")

                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Choice(
                        "Max. Umstiege", filters.maxTransfers,
                        listOf("" to "Beliebig", "0" to "Nur direkt", "1" to "1", "2" to "2", "3" to "3"),
                        { set(filters.copy(maxTransfers = it)) }, Modifier.weight(1f),
                    )
                    Choice(
                        "Max. Reisedauer", filters.maxTravel,
                        listOf("" to "Beliebig", "30" to "30 Min.", "60" to "1 Std.", "120" to "2 Std.", "180" to "3 Std.", "240" to "4 Std.", "360" to "6 Std."),
                        { set(filters.copy(maxTravel = it)) }, Modifier.weight(1f),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Choice(
                        "Fußweg", filters.maxWalk,
                        listOf("" to "Automatisch", "5" to "Max. 5 Min.", "10" to "Max. 10 Min.", "15" to "Max. 15 Min.", "30" to "Max. 30 Min."),
                        { set(filters.copy(maxWalk = it)) }, Modifier.weight(1f),
                    )
                    Choice(
                        "Umstiegszeit", filters.extraTransfer,
                        listOf("" to "Normal", "5" to "5 Min. mehr", "10" to "10 Min. mehr", "15" to "15 Min. mehr"),
                        { set(filters.copy(extraTransfer = it)) }, Modifier.weight(1f),
                    )
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label("Verkehrsmittel")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MODE_LABELS.forEach { (code, text) ->
                            ToggleChip(text, filters.modes.contains(code), { set(filters.toggleMode(code)) })
                        }
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Label("Über")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedButton(
                            onClick = { app.open(Screen.Pick(PickTarget.Via)) },
                            shapes = ButtonDefaults.shapes(),
                            modifier = Modifier.weight(1f),
                        ) {
                            Icon(Icons.Stop, null, Modifier.padding(end = 8.dp))
                            Text(filters.via?.displayName ?: "Haltestelle wählen", maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (filters.via != null) {
                            IconBtn(Icons.Close, "Zwischenhalt entfernen", onClick = { set(filters.copy(via = null, viaStay = "0")) }, size = 44.dp)
                        }
                    }
                }
                if (filters.via != null) {
                    Choice(
                        "Aufenthalt", filters.viaStay,
                        listOf("0" to "Nur durchfahren", "5" to "5 Min.", "15" to "15 Min.", "30" to "30 Min.", "60" to "1 Std.", "120" to "2 Std."),
                        { set(filters.copy(viaStay = it)) },
                    )
                }

                ListItem(
                    headlineContent = { Text("Stufenfreie Fußwege") },
                    supportingContent = { Text("Soweit bekannt. Sagt nichts über den Einstieg ins Fahrzeug.") },
                    trailingContent = { Switch(checked = filters.stepFree, onCheckedChange = { set(filters.copy(stepFree = it)) }) },
                    colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    modifier = Modifier.clickable { set(filters.copy(stepFree = !filters.stepFree)) },
                )

                if (count > 0) TextBtn("Filter zurücksetzen", { set(FilterState()) })
            }
        }
    }
}
