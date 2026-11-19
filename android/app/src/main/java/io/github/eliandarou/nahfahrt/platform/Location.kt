package io.github.eliandarou.nahfahrt.platform

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import io.github.eliandarou.nahfahrt.data.ApiError
import io.github.eliandarou.nahfahrt.logic.Fix
import io.github.eliandarou.nahfahrt.model.Station
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.math.round

/**
 * The position, straight from Android's LocationManager: no Play Services, no network service
 * of Google's in between. A position lives in memory only; nothing here writes it anywhere.
 */
object Locator {
    private fun manager(context: Context) = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private fun Location.toFix() = Fix(latitude, longitude, if (hasAccuracy()) accuracy.toDouble() else 5000.0, time)

    private fun ageMs(location: Location) = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000

    private fun enabledProviders(manager: LocationManager, precise: Boolean): List<String> =
        buildList {
            if (precise) add(LocationManager.GPS_PROVIDER)
            add(LocationManager.NETWORK_PROVIDER)
        }.filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }

    @SuppressLint("MissingPermission")
    private suspend fun ask(context: Context, precise: Boolean, timeoutMs: Long, maxAgeMs: Long): Fix {
        val manager = manager(context)
        val providers = enabledProviders(manager, precise)
        if (providers.isEmpty()) throw ApiError("location_off")
        providers.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .filter { ageMs(it) <= maxAgeMs }
            .minByOrNull { if (it.hasAccuracy()) it.accuracy else Float.MAX_VALUE }
            ?.let { return it.toFix() }

        return withContext(Dispatchers.Main) {
            withTimeoutOrNull(timeoutMs) {
                suspendCancellableCoroutine { continuation: CancellableContinuation<Fix> ->
                    val listener = object : LocationListener {
                        override fun onLocationChanged(location: Location) {
                            manager.removeUpdates(this)
                            if (continuation.isActive) continuation.resume(location.toFix())
                        }

                        @Deprecated("Needed below Android 10")
                        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
                        override fun onProviderEnabled(provider: String) = Unit
                        override fun onProviderDisabled(provider: String) = Unit
                    }
                    providers.forEach { manager.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
                    continuation.invokeOnCancellation { manager.removeUpdates(listener) }
                }
            } ?: throw ApiError("location_timeout")
        }
    }

    /** The satellite fix when there is one; indoors, what the network knows beats nothing. */
    suspend fun currentPosition(context: Context): Fix {
        if (!Permissions.location(context)) throw ApiError("location_denied")
        val precise = Permissions.granted(context, android.Manifest.permission.ACCESS_FINE_LOCATION)
        return try {
            ask(context, precise, timeoutMs = 12_000, maxAgeMs = 20_000)
        } catch (error: ApiError) {
            if (error.code != "location_timeout") throw error
            ask(context, precise = false, timeoutMs = 8_000, maxAgeMs = 120_000)
        }
    }

    /** Fills in "Mein Standort" for one request; everything else passes through unchanged. */
    suspend fun withPosition(context: Context, station: Station): Station {
        if (!station.isMe) return station
        val fix = currentPosition(context)
        // The backend accepts seven decimals; six are about ten centimetres.
        return station.copy(lat = round(fix.lat * 1e6) / 1e6, lon = round(fix.lon * 1e6) / 1e6)
    }

    /** Follows the position while collected; the screen collects it only while it is in view. */
    @SuppressLint("MissingPermission")
    fun watch(context: Context): Flow<Result<Fix>> = callbackFlow {
        if (!Permissions.location(context)) {
            trySend(Result.failure(ApiError("location_denied")))
            awaitClose()
            return@callbackFlow
        }
        val manager = manager(context)
        val precise = Permissions.granted(context, android.Manifest.permission.ACCESS_FINE_LOCATION)
        val providers = enabledProviders(manager, precise)
        if (providers.isEmpty()) {
            trySend(Result.failure(ApiError("location_off")))
            awaitClose()
            return@callbackFlow
        }
        var best: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                val known = best
                // A network fix must not replace a fresh, sharper satellite fix.
                val worse = known != null && location.provider != known.provider &&
                    location.accuracy > known.accuracy && location.time - known.time < 10_000
                if (worse) return
                best = location
                trySend(Result.success(location.toFix()))
            }

            @Deprecated("Needed below Android 10")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
        }
        providers.forEach { manager.requestLocationUpdates(it, 3_000L, 0f, listener, Looper.getMainLooper()) }
        providers.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .filter { ageMs(it) <= 10_000 }
            .maxByOrNull { it.time }
            ?.let(listener::onLocationChanged)
        awaitClose { manager.removeUpdates(listener) }
    }
}
