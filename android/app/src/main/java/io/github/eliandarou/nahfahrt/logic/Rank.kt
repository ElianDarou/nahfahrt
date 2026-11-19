package io.github.eliandarou.nahfahrt.logic

import io.github.eliandarou.nahfahrt.model.Station
import java.util.Locale
import kotlin.math.max
import kotlin.math.pow

/** Local station search: normalization, matching and usage ranking. */

private val nonAlphanumeric = Regex("[^a-z0-9]+")
private val hauptbahnhof = Regex("\\bhauptbahnhof\\b")
private val bahnhof = Regex("\\bbahnhof\\b")

fun normalize(text: String): String =
    text.lowercase(Locale.GERMAN)
        .replace("ä", "a")
        .replace("ö", "o")
        .replace("ü", "u")
        .replace("ß", "ss")
        .replace(nonAlphanumeric, " ")
        .replace(hauptbahnhof, "hbf")
        .replace(bahnhof, "bf")
        .trim()

/** Every typed word must start a word of the station, or occur within it from 3 letters on. */
fun matches(query: String, station: Station): Boolean {
    val terms = normalize(query).split(" ").filter { it.isNotEmpty() }
    if (terms.isEmpty()) return true
    val haystack = normalize("${station.label ?: ""} ${station.name} ${station.sub ?: ""}")
    val words = haystack.split(" ")
    return terms.all { term -> words.any { it.startsWith(term) } || (term.length >= 3 && haystack.contains(term)) }
}

private const val HALF_LIFE_DAYS = 45.0

/** Frequent use counts most; old habits slowly lose weight. */
fun usageScore(count: Int, last: Long, now: Long = System.currentTimeMillis()): Double {
    val ageDays = max(0L, now - last) / 86_400_000.0
    return count * 0.5.pow(ageDays / HALF_LIFE_DAYS)
}

fun byUsage(stations: List<Station>, now: Long = System.currentTimeMillis()): List<Station> =
    stations.sortedWith(
        compareByDescending<Station> { it.isFavourite }
            .thenByDescending { usageScore(it.count, it.last, now) }
            .thenByDescending { it.last },
    )
