package io.github.eliandarou.nahfahrt

import android.app.Application
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import io.github.eliandarou.nahfahrt.data.Api
import io.github.eliandarou.nahfahrt.data.Files
import io.github.eliandarou.nahfahrt.data.Saved
import io.github.eliandarou.nahfahrt.data.Store
import io.github.eliandarou.nahfahrt.platform.Migration
import io.github.eliandarou.nahfahrt.platform.Permissions
import io.github.eliandarou.nahfahrt.platform.Reminders
import io.github.eliandarou.nahfahrt.ui.App
import io.github.eliandarou.nahfahrt.ui.AppState
import io.github.eliandarou.nahfahrt.ui.NahfahrtTheme
import kotlinx.coroutines.android.awaitFrame

class NahfahrtApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Files.init(this)
        // The start page's data is read while the window comes up, not when it is drawn.
        Thread({
            Store.preload()
            Saved.all()
        }, "nahfahrt-preload").start()
    }
}

class MainActivity : ComponentActivity() {
    private var state: AppState? = null
    private var pendingKey: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen()
        super.onCreate(savedInstanceState)
        // Straight to the app: the system's icon animation would only cost frames.
        splash.setOnExitAnimationListener { it.remove() }
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        Permissions.register(this)
        pendingKey = intent.reminderKey()
        Api.warmUp()

        setContent {
            val scope = rememberCoroutineScope()
            val app = remember { AppState(applicationContext, scope).also { state = it } }
            LaunchedEffect(Unit) {
                pendingKey?.let(app::openLive)
                pendingKey = null
                // After the first frame: take over the web version's data once, then the reminders.
                awaitFrame()
                if (Migration.run(this@MainActivity)) app.changed()
                Reminders.syncAll(applicationContext)
            }
            NahfahrtTheme {
                App(app, onExit = ::finish)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val key = intent.reminderKey() ?: return
        state?.openLive(key) ?: run { pendingKey = key }
    }

    override fun onResume() {
        super.onResume()
        // Delays may have changed the times while the app was away.
        state?.let { Reminders.syncAll(applicationContext); it.changed() }
    }

    override fun onDestroy() {
        Permissions.unregister()
        super.onDestroy()
    }

    private fun Intent.reminderKey(): String? = getStringExtra(Reminders.EXTRA_KEY)
}
