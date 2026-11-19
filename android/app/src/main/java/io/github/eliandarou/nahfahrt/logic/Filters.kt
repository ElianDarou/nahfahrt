package io.github.eliandarou.nahfahrt.logic

import io.github.eliandarou.nahfahrt.model.Station
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

const val ALL_MODES = "BTUSRF"
private const val DAY_MINUTES = 24 * 60

/** The advanced search as the form holds it. Empty strings mean "not set". */
data class FilterState(
    val sort: String = "",
    val maxTransfers: String = "",
    /** Selected mode codes. */
    val modes: String = ALL_MODES,
    val maxWalk: String = "",
    val extraTransfer: String = "",
    val maxTravel: String = "",
    val stepFree: Boolean = false,
    val via: Station? = null,
    val viaStay: String = "0",
    /** Day of the time windows, yyyy-MM-dd; empty means today. */
    val date: String = "",
    /** Times as HH:mm. */
    val departFrom: String = "",
    val departTo: String = "",
    val arriveFrom: String = "",
    val arriveTo: String = "",
) {
    val hasDepartWindow: Boolean get() = departFrom.isNotEmpty() && departTo.isNotEmpty()
    val hasArriveWindow: Boolean get() = arriveFrom.isNotEmpty() && arriveTo.isNotEmpty()
    val hasTimeWindow: Boolean get() = hasDepartWindow || hasArriveWindow
    val windowStarted: Boolean
        get() = departFrom.isNotEmpty() || departTo.isNotEmpty() || arriveFrom.isNotEmpty() || arriveTo.isNotEmpty()

    /** Number of filters that differ from the default, for the collapsed panel. */
    val activeCount: Int
        get() = listOf(
            sort.isNotEmpty(), maxTransfers.isNotEmpty(), modes != ALL_MODES, maxWalk.isNotEmpty(),
            extraTransfer.isNotEmpty(), maxTravel.isNotEmpty(), stepFree, via != null,
            hasDepartWindow, hasArriveWindow,
        ).count { it }

    /** Why a search cannot run with these filters, in words for the user. */
    val problem: String?
        get() = when {
            modes.isEmpty() -> "Wähle mindestens ein Verkehrsmittel."
            departFrom.isNotEmpty() != departTo.isNotEmpty() -> "Gib für die Abfahrt beide Uhrzeiten an."
            arriveFrom.isNotEmpty() != arriveTo.isNotEmpty() -> "Gib für die Ankunft beide Uhrzeiten an."
            else -> null
        }

    /** A short description for the results header. */
    val windowLabel: String?
        get() {
            val parts = buildList {
                if (hasDepartWindow) add("Ab $departFrom–$departTo")
                if (hasArriveWindow) add("An $arriveFrom–$arriveTo")
            }
            return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
        }

    fun toggleMode(code: String): FilterState {
        val selected = if (modes.contains(code)) modes.replace(code, "")
        else ALL_MODES.filter { it.toString() == code || modes.contains(it) }
        return copy(modes = selected)
    }
}

fun todayInput(zone: ZoneId = ZoneId.systemDefault()): String = LocalDate.now(zone).toString()

private fun windowMinutes(date: String, from: String, to: String, zone: ZoneId): Pair<Long, Long> {
    val day = LocalDate.parse(date)
    val start = day.atTime(LocalTime.parse(from)).atZone(zone).toEpochSecond() / 60
    var end = day.atTime(LocalTime.parse(to)).atZone(zone).toEpochSecond() / 60
    // "22:00 bis 01:00" means the following night.
    if (end < start) end += DAY_MINUTES
    return start to end
}

/** Query parameters of the journey endpoint. */
fun FilterState.toQuery(zone: ZoneId = ZoneId.systemDefault()): Map<String, String> {
    val query = linkedMapOf<String, String>()
    if (sort.isNotEmpty()) query["sort"] = sort
    if (maxTransfers.isNotEmpty()) query["mt"] = maxTransfers
    if (modes != ALL_MODES) query["md"] = modes
    if (maxWalk.isNotEmpty()) query["wk"] = maxWalk
    if (extraTransfer.isNotEmpty()) query["xt"] = extraTransfer
    if (maxTravel.isNotEmpty()) query["tv"] = maxTravel
    if (stepFree) query["sf"] = "1"
    via?.id?.let {
        query["via"] = it
        if (viaStay != "0") query["vs"] = viaStay
    }
    val day = date.ifEmpty { todayInput(zone) }
    if (hasDepartWindow) {
        val (from, to) = windowMinutes(day, departFrom, departTo, zone)
        query["df"] = from.toString()
        query["dt"] = to.toString()
    }
    if (hasArriveWindow) {
        var (from, to) = windowMinutes(day, arriveFrom, arriveTo, zone)
        // An arrival window reaching before the departure window means the next day.
        val departStart = query["df"]?.toLong()
        if (departStart != null && from < departStart) {
            from += DAY_MINUTES
            to += DAY_MINUTES
        }
        query["af"] = from.toString()
        query["al"] = to.toString()
    }
    return query
}
