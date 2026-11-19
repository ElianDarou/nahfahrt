package io.github.eliandarou.nahfahrt.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.github.eliandarou.nahfahrt.platform.SharePalette

/** Nahfahrt's green as the seed of the fallback scheme; Android 12+ uses the wallpaper colours. */
private val LightScheme = lightColorScheme(
    primary = Color(0xFF0B7A50), onPrimary = Color.White,
    primaryContainer = Color(0xFF9EF4C8), onPrimaryContainer = Color(0xFF002113),
    secondary = Color(0xFF4E6356), onSecondary = Color.White,
    secondaryContainer = Color(0xFFD0E8D7), onSecondaryContainer = Color(0xFF0B1F15),
    tertiary = Color(0xFF3C6472), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFC0E9FA), onTertiaryContainer = Color(0xFF001F28),
    background = Color(0xFFF5FBF5), onBackground = Color(0xFF171D19),
    surface = Color(0xFFF5FBF5), onSurface = Color(0xFF171D19),
    surfaceVariant = Color(0xFFDCE5DC), onSurfaceVariant = Color(0xFF404943),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFEFF5EF),
    surfaceContainer = Color(0xFFE9EFE9), surfaceContainerHigh = Color(0xFFE4EAE4),
    surfaceContainerHighest = Color(0xFFDEE4DE),
    outline = Color(0xFF707972), outlineVariant = Color(0xFFC0C9C1),
    error = Color(0xFFBA1A1A), errorContainer = Color(0xFFFFDAD6), onErrorContainer = Color(0xFF410002),
)

private val DarkScheme = darkColorScheme(
    primary = Color(0xFF5EE0A8), onPrimary = Color(0xFF003824),
    primaryContainer = Color(0xFF005237), onPrimaryContainer = Color(0xFF9EF4C8),
    secondary = Color(0xFFB4CCBB), onSecondary = Color(0xFF203529),
    secondaryContainer = Color(0xFF364B3F), onSecondaryContainer = Color(0xFFD0E8D7),
    tertiary = Color(0xFFA4CDDD), onTertiary = Color(0xFF053542),
    tertiaryContainer = Color(0xFF234C59), onTertiaryContainer = Color(0xFFC0E9FA),
    background = Color(0xFF0F1511), onBackground = Color(0xFFDEE4DE),
    surface = Color(0xFF0F1511), onSurface = Color(0xFFDEE4DE),
    surfaceVariant = Color(0xFF404943), onSurfaceVariant = Color(0xFFC0C9C1),
    surfaceContainerLowest = Color(0xFF0A0F0C), surfaceContainerLow = Color(0xFF171D19),
    surfaceContainer = Color(0xFF1B211D), surfaceContainerHigh = Color(0xFF252B27),
    surfaceContainerHighest = Color(0xFF303632),
    outline = Color(0xFF8A938B), outlineVariant = Color(0xFF404943),
    error = Color(0xFFFFB4AB), errorContainer = Color(0xFF93000A), onErrorContainer = Color(0xFFFFDAD6),
)

/**
 * The few colours Material has no role for: delays, live times, warnings and the favourite star.
 * Everything else comes straight from the colour scheme, so the app follows the wallpaper.
 */
@Immutable
data class Colors(
    val scheme: ColorScheme,
    val late: Color,
    val live: Color,
    val warn: Color,
    val star: Color,
    val dark: Boolean,
) {
    val bg get() = scheme.surface
    val surface get() = scheme.surfaceContainerLow
    val surfaceStrong get() = scheme.surfaceContainerHighest
    val line get() = scheme.outlineVariant
    val text get() = scheme.onSurface
    val muted get() = scheme.onSurfaceVariant
    val accent get() = scheme.primary
    val onAccent get() = scheme.onPrimary
    val badBg get() = scheme.errorContainer

    fun sharePalette() = SharePalette(
        bg = scheme.surface.toArgb(), surface = scheme.surfaceContainerLow.toArgb(),
        strong = scheme.surfaceContainerHighest.toArgb(), text = scheme.onSurface.toArgb(),
        muted = scheme.onSurfaceVariant.toArgb(), accent = scheme.primary.toArgb(),
        late = late.toArgb(), warn = warn.toArgb(),
    )
}

private fun semantic(scheme: ColorScheme, dark: Boolean) = Colors(
    scheme = scheme,
    late = if (dark) Color(0xFFFF8B8B) else Color(0xFFC4242F),
    live = if (dark) Color(0xFF6FE0A6) else Color(0xFF0B7A50),
    warn = if (dark) Color(0xFFFFC266) else Color(0xFF935D00),
    star = if (dark) Color(0xFFF79A1F) else Color(0xFFD97A00),
    dark = dark,
)

val colors: Colors
    @Composable get() = semantic(MaterialTheme.colorScheme, !isLight(MaterialTheme.colorScheme))

private fun isLight(scheme: ColorScheme): Boolean {
    val c = scheme.surface
    return (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) > 0.5
}

/** Text styles of the screens, taken from the expressive type scale. */
object Type {
    val body: TextStyle @Composable get() = MaterialTheme.typography.bodyLarge
    val small: TextStyle @Composable get() = MaterialTheme.typography.bodyMedium
    val tiny: TextStyle @Composable get() = MaterialTheme.typography.bodySmall
    val title: TextStyle @Composable get() = MaterialTheme.typography.titleLarge
    val strong: TextStyle @Composable get() = MaterialTheme.typography.titleMedium
}

/** The baseline scale with the emphasized weights expressive design puts on headings and times. */
private val AppTypography = Typography().let { base ->
    base.copy(
        displaySmall = base.displaySmall.copy(fontWeight = FontWeight.SemiBold),
        headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.Bold),
        headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.Bold),
        headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold),
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 17.sp),
        labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
    )
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NahfahrtTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> DarkScheme
        else -> LightScheme
    }
    MaterialExpressiveTheme(
        colorScheme = scheme,
        motionScheme = MotionScheme.expressive(),
        typography = AppTypography,
        content = content,
    )
}
