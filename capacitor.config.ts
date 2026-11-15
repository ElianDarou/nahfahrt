import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.eliandarou.nahfahrt",
  appName: "Nahfahrt",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: {
    allowMixedContent: false,
    // Benchmark builds only: lets the DevTools protocol trace the release WebView.
    webContentsDebuggingEnabled: process.env.NF_BENCH === "1",
  },
  // Benchmark builds (NF_BENCH=1) pass the app's NFPERF console lines to logcat.
  loggingBehavior: process.env.NF_BENCH === "1" ? "production" : "debug",
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_nahfahrt", iconColor: "#0b7a50" },
  },
};

export default config;
