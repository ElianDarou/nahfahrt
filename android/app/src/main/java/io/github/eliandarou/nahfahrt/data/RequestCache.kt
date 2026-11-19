package io.github.eliandarou.nahfahrt.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async

/**
 * Shares identical requests and keeps their answers for a short while.
 *
 * While a request runs, every caller with the same key waits on the same [Deferred]. A caller
 * that gives up only stops waiting: the request runs on in [scope] and its answer is kept.
 */
class RequestCache<T>(
    private val scope: CoroutineScope,
    private val ttlMs: Long,
    /** Keeps a long session from growing without bound. */
    private val limit: Int = 24,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private class Entry<T>(val at: Long, val value: T?, val task: Deferred<T>?)

    private val entries = LinkedHashMap<String, Entry<T>>()

    /** The answer, if it is still fresh. */
    @Synchronized
    fun get(key: String): T? {
        val entry = entries[key] ?: return null
        val value = entry.value ?: return null
        if (clock() - entry.at > ttlMs) {
            entries.remove(key)
            return null
        }
        return value
    }

    /**
     * Answers from the cache, joins a running request, or starts [load] once for everyone.
     * With [fresh], a kept answer is ignored, but a request already on its way is still joined:
     * it left after the user asked, so it is as fresh as a new one.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    @Synchronized
    fun run(key: String, fresh: Boolean = false, load: suspend () -> T): Deferred<T> {
        if (!fresh) get(key)?.let { return CompletedDeferred(it) }
        entries[key]?.task?.let { return it }
        val started = clock()
        val task = scope.async(start = CoroutineStart.LAZY) { load() }
        entries[key] = Entry(started, null, task)
        task.invokeOnCompletion { failure ->
            synchronized(this) {
                if (entries[key]?.task !== task) return@synchronized
                if (failure != null) {
                    // A failure is not an answer: the next caller may try again.
                    entries.remove(key)
                } else {
                    entries.remove(key)
                    entries[key] = Entry(clock(), task.getCompleted(), null)
                    while (entries.size > limit) entries.remove(entries.keys.first())
                }
            }
        }
        task.start()
        return task
    }

    @Synchronized
    fun clear() = entries.clear()
}

/** An already known answer in the shape of a running one. */
private fun <T> CompletedDeferred(value: T): Deferred<T> = kotlinx.coroutines.CompletableDeferred(value)
