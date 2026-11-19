package io.github.eliandarou.nahfahrt.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Runtime permissions, asked for from any screen as a suspend call. */
object Permissions {
    private var launcher: ActivityResultLauncher<Array<String>>? = null
    private var pending: CompletableDeferred<Map<String, Boolean>>? = null

    /** Must run in the activity's onCreate, before it starts. */
    fun register(activity: ComponentActivity) {
        launcher = activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            pending?.complete(result)
            pending = null
        }
    }

    fun unregister() {
        launcher = null
        pending?.complete(emptyMap())
        pending = null
    }

    fun granted(context: Context, permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun hasLocation(context: Context) =
        granted(context, Manifest.permission.ACCESS_FINE_LOCATION) || granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)

    fun hasNotifications(context: Context) =
        Build.VERSION.SDK_INT < 33 || granted(context, Manifest.permission.POST_NOTIFICATIONS)

    private suspend fun request(permissions: Array<String>): Map<String, Boolean> = withContext(Dispatchers.Main) {
        val launch = launcher ?: return@withContext emptyMap()
        pending?.complete(emptyMap())
        val deferred = CompletableDeferred<Map<String, Boolean>>()
        pending = deferred
        launch.launch(permissions)
        deferred.await()
    }

    suspend fun location(context: Context): Boolean {
        if (hasLocation(context)) return true
        request(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        return hasLocation(context)
    }

    suspend fun notifications(context: Context): Boolean {
        if (hasNotifications(context)) return true
        request(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
        return hasNotifications(context)
    }
}
