import { render } from "preact";
import { App } from "./app";
import { initPerf, mark } from "./perf";
import "./styles.css";

initPerf();
render(<App />, document.getElementById("app")!);
mark("app-first-frame");
