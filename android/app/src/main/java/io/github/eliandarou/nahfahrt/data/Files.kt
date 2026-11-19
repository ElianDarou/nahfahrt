package io.github.eliandarou.nahfahrt.data

import android.content.Context
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.Executors

val AppJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
}

/**
 * Small JSON records in the app's private files, one file per key. The key names are the
 * localStorage keys of the earlier web app, so migrated data lands where it belongs.
 *
 * Reads happen once and stay in memory; writes go to disk on a background thread, newest wins.
 * Storage is a convenience: when a file is broken or the disk is full, the app keeps working.
 */
object Files {
    private lateinit var dir: File
    private val writer = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "nahfahrt-store").apply { priority = Thread.MIN_PRIORITY }
    }
    private val pending = HashMap<String, String?>()

    fun init(context: Context) {
        if (!::dir.isInitialized) dir = File(context.filesDir, "store").apply { mkdirs() }
    }

    private fun file(key: String) = File(dir, "$key.json")

    @Synchronized
    fun readRaw(key: String): String? {
        if (pending.containsKey(key)) return pending[key]
        return try {
            file(key).takeIf { it.exists() }?.readText()
        } catch (_: Exception) {
            null
        }
    }

    fun <T> read(key: String, serializer: KSerializer<T>): T? =
        readRaw(key)?.let { raw ->
            try {
                AppJson.decodeFromString(serializer, raw)
            } catch (_: Exception) {
                null
            }
        }

    @Synchronized
    fun writeRaw(key: String, raw: String?) {
        pending[key] = raw
        writer.execute { flush(key) }
    }

    fun <T> write(key: String, serializer: KSerializer<T>, value: T) =
        writeRaw(key, AppJson.encodeToString(serializer, value))

    fun remove(key: String) = writeRaw(key, null)

    private fun flush(key: String) {
        val raw = synchronized(this) {
            if (!pending.containsKey(key)) return
            pending[key]
        }
        try {
            val target = file(key)
            if (raw == null) {
                target.delete()
            } else {
                // Written aside and renamed, so a crash never leaves half a file behind.
                val temp = File(dir, "$key.json.tmp")
                temp.writeText(raw)
                if (!temp.renameTo(target)) {
                    target.delete()
                    temp.renameTo(target)
                }
            }
        } catch (_: Exception) {
            // The in-memory copy stays right; the next write tries again.
        }
        synchronized(this) {
            if (pending[key] === raw) pending.remove(key)
        }
    }

    /** Blocks until everything is on disk; for the reminder receiver, which may be killed right after. */
    fun awaitWrites() {
        writer.submit {}.get()
    }
}
