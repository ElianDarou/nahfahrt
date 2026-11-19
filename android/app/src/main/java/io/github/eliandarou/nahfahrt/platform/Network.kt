package io.github.eliandarou.nahfahrt.platform

import android.content.Context
import android.net.ConnectivityManager

object Network {
    /**
     * True on Wi-Fi and similar connections without a data allowance. Only there does the app
     * load anything ahead that may never be looked at; on mobile data it waits to be asked.
     */
    fun unmetered(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return false
        return manager.activeNetwork != null && !manager.isActiveNetworkMetered
    }
}
