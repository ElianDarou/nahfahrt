@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.eliandarou.nahfahrt.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneOffset

/** Material's date picker. Its state counts in UTC midnights, whatever the phone's zone. */
@Composable
fun DateDialog(initial: LocalDate, onDismiss: () -> Unit, onPicked: (LocalDate) -> Unit) {
    val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                val millis = state.selectedDateMillis
                if (millis != null) onPicked(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()) else onDismiss()
            }) { Text("Weiter") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    ) { DatePicker(state = state) }
}

@Composable
fun TimeDialog(initial: LocalTime, title: String, onDismiss: () -> Unit, onPicked: (LocalTime) -> Unit) {
    val state = rememberTimePickerState(initialHour = initial.hour, initialMinute = initial.minute, is24Hour = true)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { TimePicker(state = state) },
        confirmButton = { TextButton(onClick = { onPicked(LocalTime.of(state.hour, state.minute)) }) { Text("OK") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/** First the day, then the time. */
@Composable
fun DateTimeDialog(initial: LocalDateTime, onDismiss: () -> Unit, onPicked: (LocalDateTime) -> Unit) {
    var day by remember { mutableStateOf<LocalDate?>(null) }
    val chosen = day
    if (chosen == null) {
        DateDialog(initial.toLocalDate(), onDismiss) { day = it }
    } else {
        TimeDialog(initial.toLocalTime(), "Uhrzeit", onDismiss) { onPicked(LocalDateTime.of(chosen, it)) }
    }
}
