package io.github.eliandarou.nahfahrt.platform

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.content.FileProvider
import io.github.eliandarou.nahfahrt.logic.TransferRisk
import io.github.eliandarou.nahfahrt.logic.formatDay
import io.github.eliandarou.nahfahrt.logic.formatDuration
import io.github.eliandarou.nahfahrt.logic.formatTime
import io.github.eliandarou.nahfahrt.logic.formatTimeMs
import io.github.eliandarou.nahfahrt.logic.totalMinutes
import io.github.eliandarou.nahfahrt.logic.transferRisk
import io.github.eliandarou.nahfahrt.logic.transfers
import io.github.eliandarou.nahfahrt.logic.transfersText
import io.github.eliandarou.nahfahrt.logic.vehicles
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Leg
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.ceil

/** Colours of the picture, taken from the app's theme so it looks like the app. */
data class SharePalette(
    val bg: Int,
    val surface: Int,
    val strong: Int,
    val text: Int,
    val muted: Int,
    val accent: Int,
    val late: Int,
    val warn: Int,
)

/** Line chip colours, the same as in the app. */
val ModeColours: Map<String, Pair<Int, Int>> = mapOf(
    "R" to (0xFFDFE5EE.toInt() to 0xFF1A2230.toInt()),
    "S" to (0xFF1E8A4F.toInt() to 0xFFFFFFFF.toInt()),
    "U" to (0xFF2360C4.toInt() to 0xFFFFFFFF.toInt()),
    "T" to (0xFFB5322A.toInt() to 0xFFFFFFFF.toInt()),
    "B" to (0xFF7A3F9D.toInt() to 0xFFFFFFFF.toInt()),
    "F" to (0xFF0D7A8A.toInt() to 0xFFFFFFFF.toInt()),
)

/** A picture of a connection in the app's look, drawn with Android's own canvas. */
object ShareImage {
    private const val WIDTH = 420f
    const val SCALE = 2.5f
    private const val PADDING = 20f
    private const val FILE_NAME = "nahfahrt-verbindung.png"

    private class Painter(val canvas: Canvas?, val colours: SharePalette, val cardHeight: Float?) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        var y = 0f

        fun font(size: Float, weight: Int = 400) {
            paint.textSize = size
            paint.typeface = if (android.os.Build.VERSION.SDK_INT >= 28) {
                Typeface.create(Typeface.DEFAULT, weight, false)
            } else {
                Typeface.create(Typeface.DEFAULT, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
            }
        }

        fun width(text: String) = paint.measureText(text)

        fun text(text: String, x: Float, y: Float, colour: Int) {
            paint.color = colour
            canvas?.drawText(text, x, y, paint)
        }

        fun wrap(text: String, width: Float): List<String> {
            val lines = mutableListOf<String>()
            var line = ""
            for (word in text.split(" ")) {
                val candidate = if (line.isEmpty()) word else "$line $word"
                if (paint.measureText(candidate) <= width || line.isEmpty()) line = candidate
                else {
                    lines += line
                    line = word
                }
            }
            if (line.isNotEmpty()) lines += line
            return lines
        }

        fun round(left: Float, top: Float, width: Float, height: Float, radius: Float, colour: Int) {
            paint.color = colour
            canvas?.drawRoundRect(RectF(left, top, left + width, top + height), radius, radius, paint)
        }

        fun rect(left: Float, top: Float, width: Float, height: Float, colour: Int) {
            paint.color = colour
            canvas?.drawRect(left, top, left + width, top + height, paint)
        }
    }

    /** Draws the card; returns the height and the height of the inner card for the second pass. */
    private fun draw(p: Painter, from: String, to: String, journey: Journey, takenAt: Long): Pair<Float, Float> {
        val c = p.colours
        val legs = journey.vehicles
        val first = legs.first()
        val last = legs.last()
        val list = transfers(journey)
        val risk = transferRisk(journey)
        val inner = WIDTH - PADDING * 2

        p.rect(0f, 0f, WIDTH, 4000f, c.bg)
        p.y = PADDING + 16
        p.font(16f, 700)
        p.text("Nahfahrt", PADDING, p.y, c.accent)
        p.font(14f)
        val day = formatDay(first.actualDeparture)
        p.text(day, WIDTH - PADDING - p.width(day), p.y, c.muted)
        p.y += 16

        fun block(text: String, size: Float, weight: Int, colour: Int) {
            p.font(size, weight)
            for (line in p.wrap(text, inner)) {
                p.y += size * 1.3f
                p.text(line, PADDING, p.y, colour)
            }
        }

        block("$from → $to", 20f, 700, c.text)
        p.y += 6

        p.font(26f, 700)
        p.y += 32
        var x = PADDING
        fun big(text: String, colour: Int) {
            p.text(text, x, p.y, colour)
            x += p.width(text)
        }
        big(formatTime(first.actualDeparture), if (first.x != null) c.late else c.text)
        big(" – ", c.muted)
        big(formatTime(last.actualArrival), if (last.y != null) c.late else c.text)

        block("${formatDuration(totalMinutes(journey))} · ${transfersText(journey.u)}", 15f, 500, c.muted)
        when {
            legs.any { it.cancelled } -> block("Ein Teil fällt aus", 15f, 600, c.late)
            risk == TransferRisk.Broken -> block("Anschluss nicht erreichbar", 15f, 600, c.late)
            risk == TransferRisk.Tight -> block("Knapper Umstieg", 15f, 600, c.warn)
        }

        p.y += 14
        val cardTop = p.y
        // The card is painted beneath its content, so its height comes from the measuring pass.
        p.cardHeight?.let { p.round(PADDING - 6, cardTop, inner + 12, it, 14f, c.surface) }

        p.y += 14
        val left = PADDING + 8
        val nameX = left + 74

        fun stop(scheduled: Int, delay: Int?, name: String, track: String?) {
            val platform = track?.let { "Gl. $it" } ?: ""
            p.font(14f)
            val platformWidth = if (platform.isNotEmpty()) p.width(platform) + 10 else 0f
            p.font(15f, 500)
            val lines = p.wrap(name, WIDTH - PADDING - 6 - nameX - platformWidth)
            p.y += 21
            val baseline = p.y
            p.font(15f, 700)
            val late = delay != null && delay != 0
            p.text(formatTime(scheduled + (delay ?: 0)), left, baseline, if (late) c.late else c.text)
            if (late) {
                p.font(12f, 500)
                val old = formatTime(scheduled)
                val oldY = baseline + 14
                p.text(old, left, oldY, c.muted)
                p.rect(left, oldY - 4, p.width(old), 1f, c.muted)
            }
            p.font(15f, 500)
            lines.forEachIndexed { index, line -> p.text(line, nameX, baseline + index * 20, c.text) }
            if (platform.isNotEmpty()) {
                p.font(14f)
                p.text(platform, WIDTH - PADDING - 6 - p.width(platform), baseline, c.muted)
            }
            p.y += (lines.size - 1) * 20 + if (late && lines.size == 1) 15 else 0
        }

        fun legBlock(leg: Leg) {
            val (background, foreground) = ModeColours[leg.m] ?: (c.strong to c.text)
            p.font(14f, 700)
            val label = leg.n.ifEmpty { "Linie" }
            val chip = p.width(label) + 16
            p.round(left, p.y + 2, chip, 24f, 6f, background)
            p.text(label, left + 8, p.y + 19, foreground)
            if (leg.cancelled) p.rect(left + 6, p.y + 13, chip - 12, 1.5f, foreground)
            leg.h?.let {
                p.font(14f)
                val line = p.wrap("Richtung $it", WIDTH - PADDING - 6 - left - chip - 8).first()
                p.text(line, left + chip + 8, p.y + 19, c.muted)
            }
            p.y += 28
            if (leg.replacement || leg.cancelled) {
                p.font(13f, 600)
                p.y += 16
                p.text(if (leg.cancelled) "Fällt aus" else "Ersatzverkehr", left, p.y, if (leg.cancelled) c.late else c.muted)
            }
            stop(leg.a, leg.x, leg.f, leg.g)
            stop(leg.b, leg.y, leg.t, leg.k)
            p.y += 12
        }

        var vehicleIndex = -1
        journey.l.forEachIndexed { index, leg ->
            if (leg.isWalk) {
                val next = journey.l.getOrNull(index + 1)
                val buffer = if (vehicleIndex >= 0 && next != null && !next.isWalk) list.getOrNull(vehicleIndex) else null
                p.font(14f)
                p.y += 14
                p.text("Zu Fuß ${leg.walkMinutes} Min.${buffer?.let { " · ${it.minutes} Min. Umstiegszeit" } ?: ""}", left, p.y, c.muted)
                p.y += 12
                return@forEachIndexed
            }
            vehicleIndex += 1
            legBlock(leg)
        }

        val cardHeight = p.y - cardTop
        p.y += 22
        p.font(12f)
        p.text("Stand ${formatTimeMs(takenAt)} Uhr · Daten: Transitous · Nahfahrt", PADDING, p.y, c.muted)
        return (p.y + PADDING - 4) to cardHeight
    }

    /** The picture at [scale] pixels per point. */
    fun render(from: String, to: String, journey: Journey, colours: SharePalette, scale: Float, takenAt: Long): Bitmap {
        val (height, card) = draw(Painter(null, colours, null), from, to, journey, takenAt)
        val bitmap = Bitmap.createBitmap(ceil(WIDTH * scale).toInt(), ceil(height * scale).toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.scale(scale, scale)
        draw(Painter(canvas, colours, card), from, to, journey, takenAt)
        return bitmap
    }

    /** Hands text and picture to Android's share menu. Always the same file, so nothing piles up. */
    suspend fun send(context: Context, image: Bitmap?, text: String?) {
        val intent = Intent(Intent.ACTION_SEND)
        if (image != null) {
            val file = withContext(Dispatchers.IO) {
                val dir = File(context.cacheDir, "share").apply { mkdirs() }
                File(dir, FILE_NAME).also { file -> file.outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) } }
            }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            intent.type = "image/png"
            intent.putExtra(Intent.EXTRA_STREAM, uri)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            intent.clipData = android.content.ClipData.newRawUri(null, uri)
        } else {
            intent.type = "text/plain"
        }
        text?.let { intent.putExtra(Intent.EXTRA_TEXT, it) }
        context.startActivity(Intent.createChooser(intent, "Verbindung teilen").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
