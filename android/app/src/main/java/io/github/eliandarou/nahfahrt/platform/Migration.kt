package io.github.eliandarou.nahfahrt.platform

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import io.github.eliandarou.nahfahrt.data.AppJson
import io.github.eliandarou.nahfahrt.data.Files
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.data.Store
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File

/**
 * Takes over favourites, history, routes and saved connections from the earlier web version.
 *
 * That version kept them in the WebView's localStorage under the origin https://localhost.
 * Once, on the first start after the update, an invisible WebView opens that origin with a
 * page of our own that reads the nf.* keys and hands them over. Nothing leaves the phone.
 */
object Migration {
    private const val DONE = "nf.migrated.v1"
    private const val ORIGIN = "https://localhost/"
    private val KEYS = setOf(Store.STATIONS, Store.ROUTES, Store.JOURNEYS, Store.PLACES, Store.LIVE_GPS, Saved.KEY)

    private val PAGE = """
        <!doctype html><meta charset="utf-8"><script>
        var out = {};
        try {
          for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            if (key.indexOf("nf.") === 0) out[key] = localStorage.getItem(key);
          }
        } catch (e) {}
        NahfahrtMigration.done(JSON.stringify(out));
        </script>
    """.trimIndent()

    fun needed(context: Context): Boolean =
        Files.readRaw(DONE) == null && File(context.applicationInfo.dataDir, "app_webview").exists()

    private fun markDone() = Files.writeRaw(DONE, "1")

    /** Runs on the main thread. Returns true when something was taken over. */
    @SuppressLint("SetJavaScriptEnabled")
    suspend fun run(context: Context): Boolean {
        if (!needed(context)) {
            if (Files.readRaw(DONE) == null) markDone()
            return false
        }
        val result = CompletableDeferred<String>()
        val webView = WebView(context.applicationContext)
        try {
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.settings.allowFileAccess = false
            webView.settings.allowContentAccess = false
            webView.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun done(json: String) {
                        result.complete(json)
                    }
                },
                "NahfahrtMigration",
            )
            webView.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                    if (request.url.toString() != ORIGIN) return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
                    return WebResourceResponse("text/html", "utf-8", PAGE.byteInputStream())
                }
            }
            webView.loadUrl(ORIGIN)
            val json = withTimeoutOrNull(8_000) { result.await() } ?: return false
            val values = runCatching { AppJson.parseToJsonElement(json) as JsonObject }.getOrNull() ?: return false
            var taken = false
            for ((key, value) in values) {
                if (key !in KEYS || Files.readRaw(key) != null) continue
                val raw = (value as? JsonPrimitive)?.content ?: continue
                Files.writeRaw(key, raw)
                taken = true
            }
            markDone()
            Store.reload()
            Saved.reload()
            // The web version's alarms belonged to its plugin and are gone with it.
            Reminders.syncAll(context)
            return taken
        } finally {
            webView.removeJavascriptInterface("NahfahrtMigration")
            webView.destroy()
        }
    }
}
