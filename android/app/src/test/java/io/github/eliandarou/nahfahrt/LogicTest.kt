package io.github.eliandarou.nahfahrt

import io.github.eliandarou.nahfahrt.data.AppJson
import io.github.eliandarou.nahfahrt.data.applyTrip
import io.github.eliandarou.nahfahrt.data.hasCoordinates
import io.github.eliandarou.nahfahrt.data.isExpired
import io.github.eliandarou.nahfahrt.data.pickStop
import io.github.eliandarou.nahfahrt.data.vehiclesToFollow
import io.github.eliandarou.nahfahrt.logic.FilterState
import io.github.eliandarou.nahfahrt.logic.Fix
import io.github.eliandarou.nahfahrt.logic.Phase
import io.github.eliandarou.nahfahrt.logic.Point
import io.github.eliandarou.nahfahrt.logic.Position
import io.github.eliandarou.nahfahrt.logic.TransferRisk
import io.github.eliandarou.nahfahrt.logic.byUsage
import io.github.eliandarou.nahfahrt.logic.describePosition
import io.github.eliandarou.nahfahrt.logic.distanceMetres
import io.github.eliandarou.nahfahrt.logic.formatDistance
import io.github.eliandarou.nahfahrt.logic.formatDuration
import io.github.eliandarou.nahfahrt.logic.journeyStart
import io.github.eliandarou.nahfahrt.logic.matchRoute
import io.github.eliandarou.nahfahrt.logic.matches
import io.github.eliandarou.nahfahrt.logic.planReminders
import io.github.eliandarou.nahfahrt.logic.planned
import io.github.eliandarou.nahfahrt.logic.progressOf
import io.github.eliandarou.nahfahrt.logic.reminderIds
import io.github.eliandarou.nahfahrt.logic.scheduleText
import io.github.eliandarou.nahfahrt.logic.shareText
import io.github.eliandarou.nahfahrt.logic.toQuery
import io.github.eliandarou.nahfahrt.logic.totalMinutes
import io.github.eliandarou.nahfahrt.logic.transferRisk
import io.github.eliandarou.nahfahrt.logic.transfers
import io.github.eliandarou.nahfahrt.model.Journey
import io.github.eliandarou.nahfahrt.model.Leg
import io.github.eliandarou.nahfahrt.model.Place
import io.github.eliandarou.nahfahrt.model.SavedJourney
import io.github.eliandarou.nahfahrt.model.Station
import io.github.eliandarou.nahfahrt.model.TripPayload
import io.github.eliandarou.nahfahrt.model.TripStop
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

/** 9 Nov 2026, 07:00 in Berlin, in minutes since the epoch. */
private val BASE = (ZonedDateTime.of(2026, 11, 9, 7, 0, 0, 0, ZoneId.of("Europe/Berlin")).toEpochSecond() / 60).toInt()
private fun at(minute: Int) = BASE + minute

/** Walk 2, bus 0-20, walk 3, train 30-60, walk 1. */
private val journey = Journey(
    u = 1,
    l = listOf(
        Leg(m = "W", d = 2),
        Leg(m = "B", n = "12", h = "Bahnhof", f = "Dorf", t = "Bahnhof", a = at(0), b = at(20), g = "A", i = "bus"),
        Leg(m = "W", d = 3),
        Leg(m = "R", n = "RE7", h = "Basel", f = "Bahnhof", t = "Stadt", a = at(30), b = at(60), g = "2", k = "5", i = "train"),
        Leg(m = "W", d = 1),
    ),
)

private val trainStops = listOf(
    TripStop(n = "Bahnhof", d = at(30), la = 48.0, lo = 9.0),
    TripStop(n = "Mitte", a = at(40), d = at(41), la = 48.0, lo = 9.1),
    TripStop(n = "Stadt", a = at(60), la = 48.0, lo = 9.2),
)

private fun progress(minute: Int, stops: List<List<TripStop>?> = emptyList()) = progressOf(journey, stops, at(minute).toDouble())

class FormatTest {
    @Test fun totals() {
        assertEquals(63, totalMinutes(journey))
        assertEquals(listOf(10), transfers(journey).map { it.minutes })
        assertEquals("1 Std. 3 Min.", formatDuration(63))
        assertEquals("45 Min.", formatDuration(45))
        assertEquals("2 Std.", formatDuration(120))
    }

    @Test fun risks() {
        assertNull(transferRisk(journey))
        val tight = journey.copy(l = journey.l.map { if (it.m == "B") it.copy(y = 6) else it })
        assertEquals(TransferRisk.Tight, transferRisk(tight))
        val broken = journey.copy(l = journey.l.map { if (it.m == "B") it.copy(y = 9) else it })
        assertEquals(TransferRisk.Broken, transferRisk(broken))
    }

    @Test fun distances() {
        assertEquals("120 m", formatDistance(123.0))
        assertEquals("1,5 km", formatDistance(1520.0))
        assertEquals("2 km", formatDistance(2000.0))
        assertEquals(1000.0, distanceMetres(Point(48.0, 9.0), Point(48.009047, 9.0)), 5.0)
    }
}

class RankTest {
    private fun station(name: String, sub: String? = null, count: Int = 0, last: Long = 0, fav: Boolean? = null, label: String? = null) =
        Station(key = name, name = name, sub = sub, lat = 0.0, lon = 0.0, count = count, last = last, fav = fav, label = label)

    @Test fun matching() {
        assertTrue(matches("stutt", station("Stuttgart Hbf")))
        assertTrue(matches("stuttgart hauptbahnhof", station("Stuttgart Hbf")))
        assertTrue(matches("muhl", station("Mühlacker")))
        assertTrue(matches("arbeit", station("Heilbronn Hbf", label = "Arbeit")))
        assertTrue(matches("heil", station("Hbf", sub = "Heilbronn")))
        assertFalse(matches("stuttgart ulm", station("Stuttgart Hbf")))
    }

    @Test fun ordering() {
        val now = 1_800_000_000_000
        val list = byUsage(
            listOf(station("Selten", count = 1, last = now), station("Oft", count = 9, last = now), station("Fav", fav = true)),
            now,
        )
        assertEquals(listOf("Fav", "Oft", "Selten"), list.map { it.name })
        val faded = byUsage(listOf(station("Alt", count = 8, last = now - 200 * 86_400_000L), station("Neu", count = 3, last = now)), now)
        assertEquals("Neu", faded.first().name)
    }
}

class ProgressTest {
    @Test fun upcoming() {
        assertEquals(at(-2), journeyStart(journey))
        val state = progress(-32)
        assertEquals(Phase.Upcoming, state.phase)
        assertEquals("In 30 Min. losgehen", state.headline)
        assertEquals("12 Richtung Bahnhof ab Dorf, Gleis A", state.detail)
        assertTrue(progress(-3 * 24 * 60).headline.contains("9. Nov"))
    }

    @Test fun approachRideTransfer() {
        assertEquals("12 fährt in 1 Min.", progress(-1).headline)
        assertEquals("Ausstieg Bahnhof in 10 Min.", progress(10).detail)
        val transfer = progress(25)
        assertEquals(Phase.Transfer, transfer.phase)
        assertEquals("Umstieg in Bahnhof", transfer.headline)
        assertEquals(1, transfer.vehicle)
    }

    @Test fun stops() {
        val riding = progress(35, listOf(null, trainStops))
        assertEquals(Phase.Riding, riding.phase)
        assertEquals("Nächster Halt Mitte in 5 Min. · Ausstieg Stadt in 25 Min.", riding.detail)
        val stopped = progress(40, listOf(null, trainStops))
        assertEquals(Phase.Stopped, stopped.phase)
        assertEquals("RE7 hält in Mitte", stopped.headline)
        assertEquals("Ausstieg Stadt in 15 Min.", progress(45, listOf(null, trainStops)).detail)
    }

    @Test fun end() {
        assertEquals(Phase.FinalWalk, progress(60).phase)
        val arrived = progress(62)
        assertEquals(Phase.Arrived, arrived.phase)
        assertEquals(1.0, arrived.share, 0.0)
    }
}

class PositionTest {
    private fun fix(lat: Double, lon: Double, accuracy: Double = 20.0) = Fix(lat, lon, accuracy, 0)

    @Test fun onTheLine() {
        val match = matchRoute(trainStops, 1, fix(48.0, 9.05), at(37).toDouble())
        assertNotNull(match)
        match!!
        assertTrue(match.onRoute)
        assertFalse(match.atStop)
        assertEquals(1, match.stopsPassed)
        assertEquals("Zwischen Bahnhof und Mitte", match.where)
        assertEquals(2, match.behindSchedule)
        assertEquals("2 Min. hinter dem Fahrplan", scheduleText(match.behindSchedule))
        assertEquals("Im Fahrplan", scheduleText(1))
    }

    @Test fun atStopAndFarAway() {
        val atStop = matchRoute(trainStops, 1, fix(48.0, 9.1), at(40).toDouble())!!
        assertTrue(atStop.atStop)
        assertEquals("In Mitte", atStop.where)
        assertEquals(0, atStop.behindSchedule)
        assertFalse(matchRoute(trainStops, 1, fix(48.2, 9.05), at(37).toDouble())!!.onRoute)
    }

    @Test fun planIgnoresDelays() {
        val late = journey.copy(l = journey.l.map { if (it.m == "R") it.copy(x = 10, y = 10) else it })
        assertEquals(Phase.Transfer, progressOf(late, emptyList(), at(35).toDouble()).phase)
        assertEquals(Phase.Riding, planned(late, emptyList(), at(35).toDouble()).phase)
    }

    @Test fun weakAndWalk() {
        assertTrue(describePosition(journey, listOf(null, trainStops), fix(48.0, 9.0, 5000.0), at(0).toDouble()) is Position.Weak)
        val walk = describePosition(journey, listOf(listOf(TripStop(n = "Dorf", d = at(0), la = 48.0, lo = 9.0)), trainStops), fix(48.0, 9.01), at(-10).toDouble())
        assertTrue(walk is Position.Walk)
        walk as Position.Walk
        assertEquals("Dorf", walk.stop)
        assertEquals(10, walk.minutesLeft)
    }
}

class RemindersTest {
    @Test fun plan() {
        val plan = planReminders(journey, at(-60).toDouble())
        assertEquals(listOf(0, 1, 2), plan.map { it.slot })
        assertEquals("In 10 Min. losgehen", plan[0].title)
        assertEquals(at(-12), plan[0].at)
        assertEquals("Gleich aussteigen: Bahnhof", plan[1].title)
        assertEquals("Weiter mit RE7 ab Bahnhof, Gl. 2, 07:30 Uhr", plan[1].body)
        assertEquals("Ankunft 08:00 Uhr, Gl. 5", plan[2].body)
        assertEquals(listOf(2), planReminders(journey, at(30).toDouble()).map { it.slot })
    }

    @Test fun idsMatchTheWebVersion() {
        // Reference value computed with the web app's JavaScript.
        assertEquals(700427600, reminderIds("S1@29000000>RE7@29000030").first())
        assertEquals(16, reminderIds("x").toSet().size)
    }

    @Test fun text() {
        val text = shareText("Dorf", "Stadt", journey)
        assertTrue(text.startsWith("Dorf → Stadt\n"))
        assertTrue(text.contains("07:00 12 Richtung Bahnhof ab Dorf, Gl. A"))
        assertTrue(text.contains("Zu Fuß 3 Min."))
    }
}

class SavedTest {
    private val entry = SavedJourney("k", "Dorf", "Stadt", journey, listOf(null, null))

    @Test fun expiry() {
        assertFalse(isExpired(journey, at(61 + 15).toDouble()))
        assertTrue(isExpired(journey, at(61 + 16).toDouble()))
    }

    @Test fun tripUpdates() {
        val full = applyTrip(entry, 1, TripPayload(trainStops.map { it.copy(x = 2, y = 3, g = "7") }.let { list ->
            list.mapIndexed { i, s -> if (i == list.lastIndex) s.copy(x = 4, g = "9") else s }
        }, r = 1), false, 5)!!
        val train = full.journey.l[3]
        assertEquals(3, train.x)
        assertEquals(4, train.y)
        assertEquals("7", train.g)
        assertEquals("9", train.k)
        assertEquals(1, train.r)
        assertTrue(hasCoordinates(full.stopsOf(1)))

        val update = applyTrip(full, 1, TripPayload(listOf(TripStop(), TripStop(x = 1), TripStop())), true)!!
        assertEquals("Mitte", update.stopsOf(1)!![1].n)
        assertEquals(1, update.stopsOf(1)!![1].x)
        assertNull(update.journey.l[3].x)
        assertNull(applyTrip(full, 1, TripPayload(listOf(TripStop())), true))
    }

    @Test fun following() {
        assertEquals(listOf(0, 1), vehiclesToFollow(journey, at(-30).toDouble()))
        assertEquals(listOf(1), vehiclesToFollow(journey, at(30).toDouble()))
    }

    @Test fun readsTheWebVersionsJson() {
        // As the web app wrote it to localStorage, nulls for stop lists not loaded yet.
        val raw = """[{"key":"12@1000","from":"A","to":"B","journey":{"u":0,"l":[{"m":"W","d":4},
            {"m":"B","n":"12","f":"A","t":"B","a":1000,"b":1020,"r":1,"i":"t1"}]},"stops":[null],"bell":1}]"""
        val list = AppJson.decodeFromString(ListSerializer(SavedJourney.serializer()), raw)
        assertEquals(1, list.size)
        assertTrue(list[0].hasBell)
        assertTrue(list[0].journey.l[0].isWalk)
        assertEquals("t1", list[0].journey.l[1].i)
        val stations = """[{"key":"48.7836,9.1817","name":"Stuttgart Hbf","id":"de:1","lat":48.78357,"lon":9.18166,"addr":false,"count":3,"last":1762600000000,"fav":true}]"""
        val station = AppJson.decodeFromString(ListSerializer(Station.serializer()), stations).single()
        assertTrue(station.isFavourite)
        assertEquals(1762600000000, station.last)
    }
}

class FiltersAndStopsTest {
    @Test fun query() {
        assertTrue(FilterState().toQuery().isEmpty())
        assertEquals(0, FilterState().activeCount)
        val chosen = FilterState(sort = "fast", modes = "BS", maxWalk = "10", stepFree = true)
        assertEquals(mapOf("sort" to "fast", "md" to "BS", "wk" to "10", "sf" to "1"), chosen.toQuery())
        assertEquals(4, chosen.activeCount)
        val night = FilterState(date = "2026-11-09", departFrom = "22:00", departTo = "01:00").toQuery(ZoneId.of("Europe/Berlin"))
        assertEquals(180L, night.getValue("dt").toLong() - night.getValue("df").toLong())
        assertEquals("Gib für die Abfahrt beide Uhrzeiten an.", FilterState(departFrom = "08:00").problem)
        assertEquals("Wähle mindestens ein Verkehrsmittel.", FilterState(modes = "").problem)
        val noId = FilterState(via = Station(key = "x", name = "X", lat = 0.0, lon = 0.0)).toQuery()
        assertFalse(noId.containsKey("via"))
        assertEquals("BTSRF", FilterState().toggleMode("U").modes)
        assertEquals("BTUSRF", FilterState(modes = "BTSRF").toggleMode("U").modes)
    }

    @Test fun picking() {
        val places = listOf(Place(n = "Rathaus", y = 48.0, x = 9.0005), Place(n = "Marktplatz", y = 48.0, x = 9.0001))
        assertEquals("Marktplatz", pickStop(places, "Marktplatz", 48.0, 9.0)?.n)
        assertEquals("Marktplatz", pickStop(listOf(Place(n = "Stuttgart, Marktplatz", y = 48.0, x = 9.001)), "Marktplatz", 48.0, 9.0)?.n?.substringAfter(", "))
        assertNull(pickStop(listOf(Place(n = "Marktplatz", y = 48.1, x = 9.0)), "Marktplatz", 48.0, 9.0))
        assertEquals("Rathaus", pickStop(listOf(Place(n = "Rathaus", y = 48.0, x = 9.0005)), "Anderswo", 48.0, 9.0)?.n)
    }
}
