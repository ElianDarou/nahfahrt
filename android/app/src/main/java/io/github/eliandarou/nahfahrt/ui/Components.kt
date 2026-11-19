@file:OptIn(ExperimentalMaterial3ExpressiveApi::class, ExperimentalMaterial3Api::class)

package io.github.eliandarou.nahfahrt.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.ToggleButton
import androidx.compose.material3.ToggleButtonDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.eliandarou.nahfahrt.logic.formatTime
import io.github.eliandarou.nahfahrt.logic.lineLabel
import io.github.eliandarou.nahfahrt.model.Leg
import io.github.eliandarou.nahfahrt.platform.ModeColours
import kotlinx.coroutines.delay

/** Waiting shorter than this needs no indicator, and an animation costs frames and battery. */
const val SPINNER_DELAY_MS = 300L

/** True once [active] has been true for [delayMs]; false as soon as it ends. */
@Composable
fun rememberDelayed(active: Boolean, delayMs: Long = SPINNER_DELAY_MS): Boolean {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(active) {
        shown = false
        if (active) {
            delay(delayMs)
            shown = true
        }
    }
    return active && shown
}

/** Material's expressive loading indicator: the morphing shape instead of a spinning ring. */
@Composable
fun Spinner(size: Dp = 32.dp, label: String = "Lädt") {
    LoadingIndicator(modifier = Modifier.size(size).semantics { contentDescription = label })
}

@Composable
fun IconBtn(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    tint: Color = LocalContentColor.current,
    size: Dp = 48.dp,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        shapes = IconButtonDefaults.shapes(),
        modifier = modifier.size(size).semantics { contentDescription = label },
    ) {
        Icon(icon, contentDescription = null, tint = if (enabled) tint else colors.muted)
    }
}

@Composable
fun TextBtn(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    TextButton(onClick = onClick, enabled = enabled, shapes = ButtonDefaults.shapes(), modifier = modifier.heightIn(min = 44.dp)) {
        if (icon != null) {
            Icon(icon, null, modifier = Modifier.size(ButtonDefaults.IconSize))
            Box(Modifier.size(ButtonDefaults.IconSpacing))
        }
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    small: Boolean = false,
    interactionSource: MutableInteractionSource? = null,
) {
    val height = if (small) ButtonDefaults.MinHeight else ButtonDefaults.MediumContainerHeight
    Button(
        onClick = onClick,
        enabled = enabled,
        shapes = ButtonDefaults.shapesFor(height),
        contentPadding = ButtonDefaults.contentPaddingFor(height),
        interactionSource = interactionSource,
        modifier = modifier.heightIn(min = height),
    ) {
        Text(text, style = if (small) MaterialTheme.typography.labelLarge else MaterialTheme.typography.titleMedium)
    }
}

/** A Material top app bar with an optional subtitle under the title. */
@Composable
fun AppBar(
    title: String,
    subtitle: String? = null,
    navigation: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Column {
                Text(
                    title,
                    style = if (subtitle != null) MaterialTheme.typography.titleMedium else MaterialTheme.typography.titleLarge,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() },
                )
                if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = colors.muted)
            }
        },
        navigationIcon = { navigation?.invoke() },
        actions = actions,
        windowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
        colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.bg),
    )
}

/** Corners of one item in an expressive segmented list: round outside, tight between items. */
@Composable
fun segmentShape(index: Int, count: Int): Shape {
    val outer = 20.dp
    val inner = 4.dp
    return RoundedCornerShape(
        topStart = if (index == 0) outer else inner,
        topEnd = if (index == 0) outer else inner,
        bottomStart = if (index == count - 1) outer else inner,
        bottomEnd = if (index == count - 1) outer else inner,
    )
}

class GroupScope {
    internal val items = mutableListOf<@Composable () -> Unit>()
    fun item(content: @Composable () -> Unit) {
        items += content
    }
}

/** A segmented group as in Android's own settings: separate tiles, two dp apart. */
@Composable
fun Group(modifier: Modifier = Modifier, build: GroupScope.() -> Unit) {
    val scope = GroupScope().apply(build)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        scope.items.forEachIndexed { index, content ->
            Surface(shape = segmentShape(index, scope.items.size), color = colors.surface, modifier = Modifier.fillMaxWidth()) {
                content()
            }
        }
    }
}

@Composable
fun Heading(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = colors.accent,
        modifier = modifier.padding(start = 16.dp, top = 24.dp, bottom = 8.dp).semantics { heading() },
    )
}

enum class Tone { Plain, Warn, Bad }

@Composable
fun Note(text: String, tone: Tone = Tone.Plain, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier,
        style = Type.small,
        color = when (tone) {
            Tone.Plain -> colors.muted
            Tone.Warn -> colors.warn
            Tone.Bad -> colors.late
        },
        fontWeight = if (tone == Tone.Plain) FontWeight.Normal else FontWeight.SemiBold,
    )
}

@Composable
fun Banner(bad: Boolean = false, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(
            containerColor = if (bad) colors.scheme.errorContainer else colors.scheme.secondaryContainer,
            contentColor = if (bad) colors.scheme.onErrorContainer else colors.scheme.onSecondaryContainer,
        ),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), content = content)
    }
}

@Composable
fun BannerText(text: String, bad: Boolean = false) = Banner(bad) { Text(text, style = Type.small) }

@Composable
fun Hint(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        color = colors.muted,
        textAlign = TextAlign.Center,
        style = Type.body,
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp),
    )
}

/** Line chips keep the transit colours: they identify the vehicle, not the theme. */
@Composable
fun LineChip(leg: Leg, modifier: Modifier = Modifier) {
    val (background, foreground) = ModeColours[leg.m]?.let { Color(it.first) to Color(it.second) }
        ?: (colors.surfaceStrong to colors.text)
    Surface(shape = MaterialTheme.shapes.small, color = background, contentColor = foreground, modifier = modifier) {
        Text(
            lineLabel(leg),
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            textDecoration = if (leg.cancelled) TextDecoration.LineThrough else null,
            maxLines = 1,
        )
    }
}

@Composable
fun PlainChip(text: String) {
    Surface(shape = MaterialTheme.shapes.small, color = colors.surfaceStrong) {
        Text(text, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelLarge)
    }
}

/** A time with its delay: the planned time struck through, the expected one in colour. */
@Composable
fun TimeText(scheduled: Int, delay: Int?, live: Boolean, style: TextStyle = Type.body, weight: FontWeight = FontWeight.SemiBold) {
    val late = delay ?: 0
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(
            formatTime(scheduled),
            style = style,
            fontWeight = if (late != 0) FontWeight.Medium else weight,
            color = when {
                late != 0 -> colors.muted
                live -> colors.live
                else -> LocalContentColor.current
            },
            textDecoration = if (late != 0) TextDecoration.LineThrough else null,
        )
        if (late != 0) {
            Text(formatTime(scheduled + late), style = style, fontWeight = weight, color = if (late > 0) colors.late else colors.live)
        }
    }
}

/** A connected button group: one choice out of a few, as Material 3 Expressive draws it. */
@Composable
fun Segments(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ButtonGroupDefaults.ConnectedSpaceBetween)) {
        options.forEachIndexed { index, (value, text) ->
            ToggleButton(
                checked = value == selected,
                onCheckedChange = { onSelect(value) },
                shapes = when (index) {
                    0 -> ButtonGroupDefaults.connectedLeadingButtonShapes()
                    options.lastIndex -> ButtonGroupDefaults.connectedTrailingButtonShapes()
                    else -> ButtonGroupDefaults.connectedMiddleButtonShapes()
                },
                // Unchosen options keep a container, so the group reads as one control.
                colors = ToggleButtonDefaults.toggleButtonColors(
                    containerColor = colors.scheme.surfaceContainerHighest,
                    contentColor = colors.scheme.onSurfaceVariant,
                ),
                modifier = Modifier.weight(1f).semantics { role = Role.RadioButton },
            ) {
                Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** A toggle with an icon, for switches that sit side by side. */
@Composable
fun IconToggle(text: String, icon: ImageVector, checked: Boolean, onChange: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    ToggleButton(
        checked = checked,
        onCheckedChange = { onChange() },
        enabled = enabled,
        shapes = ToggleButtonDefaults.shapes(),
        modifier = modifier.heightIn(min = 48.dp),
        contentPadding = PaddingValues(horizontal = 12.dp),
    ) {
        Icon(icon, null, modifier = Modifier.size(ToggleButtonDefaults.IconSize))
        Box(Modifier.size(ToggleButtonDefaults.IconSpacing))
        Text(text, maxLines = 1)
    }
}

@Composable
fun ToggleChip(text: String, on: Boolean, onClick: () -> Unit, enabled: Boolean = true) {
    FilterChip(
        selected = on,
        onClick = onClick,
        enabled = enabled,
        label = { Text(text) },
        leadingIcon = if (on) ({ Icon(Icons.Check, null, Modifier.size(18.dp)) }) else null,
    )
}

/** Something that does one thing on a tap and another when held. */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.tapOrHold(onTap: () -> Unit, onHold: () -> Unit, label: String? = null): Modifier =
    combinedClickable(onClick = onTap, onLongClick = onHold, onClickLabel = label, onLongClickLabel = "Mehr Aktionen", role = Role.Button)

/** A Material list item; held, it opens more actions. */
@Composable
fun ListRow(
    icon: ImageVector?,
    title: String,
    sub: String?,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    onHold: (() -> Unit)? = null,
    iconTint: Color = LocalContentColor.current,
    enabled: Boolean = true,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val press = if (onHold != null) Modifier.tapOrHold(onTap, onHold) else Modifier.clickable(enabled = enabled, onClick = onTap)
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = if (!sub.isNullOrEmpty()) ({ Text(sub) }) else null,
        leadingContent = icon?.let { { Icon(it, null, tint = iconTint) } },
        trailingContent = { Row(verticalAlignment = Alignment.CenterVertically, content = trailing) },
        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
        modifier = modifier.fillMaxWidth().then(press),
    )
}

@Composable
fun Toast(text: String, modifier: Modifier = Modifier) {
    Snackbar(modifier = modifier.widthIn(max = 560.dp).padding(horizontal = 16.dp)) { Text(text) }
}

val ScreenPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp)
