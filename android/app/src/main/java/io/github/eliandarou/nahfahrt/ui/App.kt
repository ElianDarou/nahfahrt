package io.github.eliandarou.nahfahrt.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.model.Station

@Composable
fun App(app: AppState, onExit: () -> Unit) {
    BackHandler(enabled = app.sheet != null || app.stack.size > 1) {
        if (!app.back()) onExit()
    }
    Box(Modifier.fillMaxSize().background(colors.bg)) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
            when (val screen = app.screen) {
                Screen.Home -> HomeScreen(app)
                is Screen.Pick -> PickerScreen(
                    app = app,
                    title = when (screen.target) {
                        PickTarget.From -> "Start wählen"
                        PickTarget.To -> "Ziel wählen"
                        PickTarget.Via -> "Zwischenhalt wählen"
                    },
                    stopsOnly = screen.target == PickTarget.Via,
                    onPick = { station: Station ->
                        when (screen.target) {
                            PickTarget.From -> app.from = station
                            PickTarget.To -> app.to = station
                            PickTarget.Via -> app.filters = app.filters.copy(via = station)
                        }
                        app.back()
                    },
                )
                Screen.Results -> app.results?.let { ResultsScreen(app, it) } ?: HomeScreen(app)
                is Screen.Live -> LiveScreen(app, screen.key)
            }
        }

        when (val sheet = app.sheet) {
            is Sheet.StationActions -> StationSheet(
                stop = sheet.stop,
                onClose = app::closeSheet,
                onStart = { station ->
                    app.from = station
                    app.showToast("${station.displayName} ist jetzt der Start")
                    app.goHome()
                },
                onDestination = { station ->
                    app.to = station
                    app.showToast("${station.displayName} ist jetzt das Ziel")
                    app.goHome()
                },
                onFavourite = { station ->
                    val updated = Store.toggleFavourite(station)
                    app.changed()
                    app.showToast(
                        if (updated.isFavourite) "${updated.displayName} ist jetzt ein Favorit"
                        else "${updated.displayName} ist kein Favorit mehr",
                    )
                    app.closeSheet()
                },
            )
            is Sheet.Share -> ShareSheet(
                from = sheet.from,
                to = sheet.to,
                journey = sheet.journey,
                onClose = app::closeSheet,
                onDone = { message ->
                    message?.let(app::showToast)
                    app.closeSheet()
                },
            )
            null -> Unit
        }

        app.toast?.let {
            Toast(
                it,
                Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.navigationBars).padding(bottom = 20.dp),
            )
        }
    }
}
