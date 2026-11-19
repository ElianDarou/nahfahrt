package io.github.eliandarou.nahfahrt

import io.github.eliandarou.nahfahrt.data.RequestCache
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RequestCacheTest {
    private var now = 0L

    private fun TestScope.cache(ttl: Long = 60_000, limit: Int = 24) =
        // Supervised, as in the app: one failed request must not end the others.
        RequestCache<String>(CoroutineScope(backgroundScope.coroutineContext + SupervisorJob(backgroundScope.coroutineContext[Job])), ttl, limit) { now }

    @Test fun sharesOneRequest() = runTest {
        val cache = cache()
        var calls = 0
        val gate = CompletableDeferred<Unit>()
        val first = cache.run("a") { calls++; gate.await(); "x" }
        val second = cache.run("a") { calls++; "y" }
        gate.complete(Unit)
        assertEquals("x", first.await())
        assertEquals("x", second.await())
        assertEquals(1, calls)
    }

    @Test fun keepsAnswersUntilTheyExpire() = runTest {
        val cache = cache()
        var calls = 0
        cache.run("a") { calls++; "x" }.await()
        runCurrent()
        assertEquals("x", cache.get("a"))
        cache.run("a") { calls++; "y" }.await()
        assertEquals(1, calls)
        now = 60_001
        assertNull(cache.get("a"))
    }

    @Test fun freshIgnoresAKeptAnswer() = runTest {
        val cache = cache()
        cache.run("a") { "old" }.await()
        runCurrent()
        assertEquals("new", cache.run("a", fresh = true) { "new" }.await())
    }

    @Test fun aFailureIsNotKept() = runTest {
        val cache = cache()
        runCatching { cache.run("a") { error("down") }.await() }
        runCurrent()
        assertEquals("x", cache.run("a") { "x" }.await())
    }

    @Test fun aCallerLeavingDoesNotStopTheRequest() = runTest {
        val cache = cache()
        val gate = CompletableDeferred<Unit>()
        val waiting = async { cache.run("a") { gate.await(); "x" }.await() }
        runCurrent()
        waiting.cancelAndJoin()
        gate.complete(Unit)
        runCurrent()
        assertEquals("x", cache.get("a"))
    }

    @Test fun staysSmall() = runTest {
        val cache = cache(limit = 3)
        repeat(5) { cache.run("k$it") { "v$it" }.await() }
        runCurrent()
        assertNull(cache.get("k0"))
        assertEquals("v4", cache.get("k4"))
    }
}
