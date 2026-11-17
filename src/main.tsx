import { render } from "preact";
import { App } from "./app";
import { loadModule } from "./lazy";
import { initPerf, mark } from "./perf";
import "./styles.css";

initPerf();
render(<App />, document.getElementById("app")!);
mark("app-first-frame");

// The start page is on screen. The rest of the app arrives while nothing is happening, so
// opening a connection, sharing or the advanced search costs no download later on.
const warm = () => {
  void loadModule("live", () => import("./live"));
  void loadModule("share", () => import("./share-sheet"));
  void loadModule("advanced", () => import("./advanced"));
};

if (typeof window.requestIdleCallback === "function") {
  window.requestIdleCallback(warm, { timeout: 3000 });
} else {
  setTimeout(warm, 1200);
}

// The static skeleton in index.html only bridges the time until the first render.
document.getElementById("boot")?.remove();
