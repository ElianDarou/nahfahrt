package io.github.eliandarou.nahfahrt;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Keeps the launch screen up until the first frame is drawn, then hands over without
        // the system's icon animation, which would cost several frames before the app shows.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        splash.setOnExitAnimationListener(splashScreenView -> splashScreenView.remove());
        paintWindow();

        // The app's screens live in the WebView history, so the back button walks through them.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        paintWindow();
    }

    /**
     * Older WebViews leave the system bars to the window, which must match the app. The WebView
     * itself starts in the app's colour too, instead of white until the first page frame.
     */
    private void paintWindow() {
        getWindow().setBackgroundDrawableResource(R.color.app_background);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.app_background));
        }
    }
}
