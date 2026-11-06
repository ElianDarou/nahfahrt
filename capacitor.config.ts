import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.eliandarou.nahfahrt",
  appName: "Nahfahrt",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: "ic_stat_nahfahrt", iconColor: "#0b7a50" },
  },
};

export default config;
