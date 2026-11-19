@file:OptIn(ExperimentalMaterial3Api::class)

package io.github.eliandarou.nahfahrt.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.Text
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.eliandarou.nahfahrt.data.StopRef
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.data.errorText
import io.github.eliandarou.nahfahrt.data.resolveStop
import io.github.eliandarou.nahfahrt.logic.shareText
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Station
import io.github.eliandarou.nahfahrt.platform.ShareImage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Material's modal bottom sheet; swiping down, a tap beside it or back closes it. */
@Composable
private fun BottomSheet(onClose: () -> Unit, label: String, content: @Composable () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = colors.scheme.surfaceContainerLow,
        modifier = Modifier.semantics { contentDescription = label },
    ) {
        Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp).imePadding()) { content() }
    }
}

@Composable
private fun SheetAction(icon: ImageVector, text: String, enabled: Boolean, tint: Color = colors.text, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(text, color = if (enabled) colors.text else colors.muted) },
        leadingContent = { Icon(icon, null, tint = if (enabled) tint else colors.muted) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = Modifier.clip(MaterialTheme.shapes.large).clickable(enabled = enabled, role = Role.Button, onClick = onClick),
    )
}

@Composable
fun StationSheet(
    stop: StopRef,
    onClose: () -> Unit,
    onStart: (Station) -> Unit,
    onDestination: (Station) -> Unit,
    onFavourite: (Station) -> Unit,
) {
    var station by remember(stop) { mutableStateOf<Station?>(null) }
    var error by remember(stop) { mutableStateOf<String?>(null) }
    LaunchedEffect(stop) {
        try {
            station = resolveStop(stop)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (failure: Exception) {
            error = errorText(failure)
        }
    }
    val found = station
    val favourite = found != null && Store.isFavourite(found.key)
    val title = found?.displayName ?: stop.name

    BottomSheet(onClose, title) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = Type.title, modifier = Modifier.semantics { heading() })
            if (found?.sub != null && found.label == null) Text(found.sub, color = colors.muted, style = Type.small)
            error?.let { Note(it, Tone.Bad) }
            if (found == null && error == null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Spinner(16.dp)
                    Text("Haltestelle wird gesucht", color = colors.muted, style = Type.small)
                }
            }
            Column(Modifier.padding(top = 8.dp)) {
                SheetAction(Icons.Start, "Als Start nehmen", found != null) { found?.let(onStart) }
                SheetAction(Icons.Address, "Als Ziel nehmen", found != null) { found?.let(onDestination) }
                SheetAction(
                    if (favourite) Icons.StarFilled else Icons.Star,
                    if (favourite) "Aus Favoriten entfernen" else "Zu Favoriten hinzufügen",
                    found != null,
                    tint = if (favourite) colors.star else colors.text,
                ) { found?.let(onFavourite) }
            }
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { TextBtn("Abbrechen", onClose) }
        }
    }
}

@Composable
fun ShareSheet(from: String, to: String, journey: Journey, onClose: () -> Unit, onDone: (String?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val palette = colors.sharePalette()
    val density = LocalDensity.current.density
    var withImage by remember { mutableStateOf(true) }
    var withText by remember { mutableStateOf(true) }
    var text by remember { mutableStateOf(shareText(from, to, journey)) }
    var preview by remember { mutableStateOf<Bitmap?>(null) }
    var sending by remember { mutableStateOf(false) }
    // One moment for preview and file, so both show the same "Stand".
    val takenAt = remember { System.currentTimeMillis() }

    // The sheet appears first; the picture is drawn off the main thread right after.
    LaunchedEffect(journey) {
        preview = runCatching {
            withContext(Dispatchers.Default) { ShareImage.render(from, to, journey, palette, density, takenAt) }
        }.getOrNull()
        if (preview == null) withImage = false
    }

    val canSend = (withImage && preview != null) || (withText && text.isNotBlank())

    BottomSheet(onClose, "Verbindung teilen") {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Verbindung teilen", style = Type.title, modifier = Modifier.semantics { heading() })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ToggleChip("Bild", withImage, { withImage = !withImage }, enabled = preview != null)
                ToggleChip("Text", withText, { withText = !withText })
            }
            Column(
                Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val image = preview
                if (withImage && image != null) {
                    Image(
                        image.asImageBitmap(),
                        contentDescription = "Vorschau des Bildes dieser Verbindung",
                        contentScale = ContentScale.FillWidth,
                        modifier = Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large),
                    )
                } else if (withImage) {
                    Box(Modifier.fillMaxWidth().heightIn(min = 120.dp), contentAlignment = Alignment.Center) { Spinner(48.dp) }
                }
                if (withText) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        label = { Text("Text zum Teilen") },
                        textStyle = MaterialTheme.typography.bodyMedium,
                        shape = MaterialTheme.shapes.large,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                TextBtn("Abbrechen", onClose)
                PrimaryButton(
                    "Teilen",
                    onClick = {
                        sending = true
                        scope.launch {
                            try {
                                val shownText = text.trim().takeIf { withText && it.isNotEmpty() }
                                // The full-resolution file is only made when it is really shared.
                                val file = if (withImage && preview != null) {
                                    withContext(Dispatchers.Default) {
                                        ShareImage.render(from, to, journey, palette, ShareImage.SCALE, takenAt)
                                    }
                                } else null
                                ShareImage.send(context, file, shownText)
                                onDone(null)
                            } catch (cancelled: CancellationException) {
                                throw cancelled
                            } catch (_: Exception) {
                                onDone("Das Teilen hat nicht geklappt.")
                            }
                        }
                    },
                    enabled = canSend && !sending,
                    small = true,
                )
            }
        }
    }
}

