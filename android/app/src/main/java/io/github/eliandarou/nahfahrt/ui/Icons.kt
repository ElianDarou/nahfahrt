package io.github.eliandarou.nahfahrt.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** The web version's line icons, drawn from the same SVG paths. Colour comes from the tint. */
object Icons {
    private fun circle(cx: Float, cy: Float, r: Float) =
        "M${cx - r},${cy}a$r,$r 0 1,0 ${2 * r},0a$r,$r 0 1,0 ${-2 * r},0"

    private fun icon(name: String, vararg paths: String, filled: Boolean = false, size: Int = 24): ImageVector =
        ImageVector.Builder(name, size.dp, size.dp, 24f, 24f).apply {
            for (path in paths) {
                addPath(
                    pathData = addPathNodes(path),
                    fill = if (filled) SolidColor(Color.Black) else null,
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    val Check by lazy { icon("check", "M5 12.5l4.5 4.5L19 7.5") }
    val Search by lazy { icon("search", circle(10.5f, 10.5f, 6.5f), "M15.5 15.5L20 20") }
    val Close by lazy { icon("close", "M6 6l12 12M18 6L6 18") }
    val Back by lazy { icon("back", "M15 5l-7 7 7 7") }
    val Swap by lazy { icon("swap", "M8 4v14M8 18l-3-3M8 18l3-3M16 20V6M16 6l-3 3M16 6l3 3") }
    val Refresh by lazy { icon("refresh", "M20 11a8 8 0 0 0-14.3-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14.3 4l1.7-2M20 20v-5h-5") }
    val Trash by lazy { icon("trash", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5") }
    val Pencil by lazy { icon("pencil", "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4", size = 20) }
    val ChevronDown by lazy { icon("down", "M6 9l6 6 6-6", size = 20) }
    val ChevronUp by lazy { icon("up", "M6 15l6-6 6 6", size = 20) }
    private const val STAR = "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"
    val Star by lazy { icon("star", STAR) }
    val StarFilled by lazy { icon("star-filled", STAR, filled = true) }
    val Stop by lazy { icon("stop", circle(12f, 12f, 9.5f), "M9 7.5v9M15 7.5v9M9 12h6") }
    val Address by lazy { icon("address", "M12 21s7-6.3 7-11.5a7 7 0 0 0-14 0C5 14.7 12 21 12 21z", circle(12f, 9.5f, 2.5f)) }
    private const val BOOKMARK = "M6 3.5h12V21l-6-4.2L6 21z"
    val Bookmark by lazy { icon("bookmark", BOOKMARK) }
    val BookmarkFilled by lazy { icon("bookmark-filled", BOOKMARK, filled = true) }
    val Location by lazy {
        icon("location", circle(12f, 12f, 3.5f), circle(12f, 12f, 7.5f), "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22")
    }
    val Nearby by lazy { icon("nearby", "M12 21s6-5.6 6-10.2A6 6 0 0 0 6 10.8C6 15.4 12 21 12 21z", "M9.5 9h5M9.5 12h5") }
    val Start by lazy { icon("start", circle(12f, 12f, 7f), circle(12f, 12f, 1.5f)) }
    val Share by lazy {
        icon("share", circle(18f, 5.5f, 2.5f), circle(6f, 12f, 2.5f), circle(18f, 18.5f, 2.5f), "M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1")
    }
    private const val BELL = "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"
    val Bell by lazy { icon("bell", BELL, "M10 21h4") }
    val BellFilled by lazy {
        ImageVector.Builder("bell-filled", 24.dp, 24.dp, 24f, 24f).apply {
            addPath(addPathNodes(BELL), fill = SolidColor(Color.Black), stroke = SolidColor(Color.Black), strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
            addPath(addPathNodes("M10 21h4"), stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round)
        }.build()
    }
}
