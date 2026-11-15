// Host benchmark: every interaction of the Nahfahrt web app in a phone-sized headless Chromium.
// Backend answers come from recorded fixtures (first run records them), so only the app's own
// work is measured. Timing comes from the app's NFPERF instrumentation (VITE_BENCH=1 build).
//
// VITE_BENCH=1 npx vite build --outDir dist-bench
// npm i --no-save playwright-core && npx playwright-core install chromium
// node scripts/bench/host-bench.mjs dist-bench bench.json [--cpu 4] [--rounds 10]
// (CHROME_PATH=/path/to/chrome uses another Chromium.)
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { createHash } from "node:crypto";

const [dist, out, ...rest] = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? Number(rest[i + 1]) : fallback;
};
const CPU = opt("--cpu", 4);
const ROUNDS = opt("--rounds", 10);
const HERE = dirname(new URL(import.meta.url).pathname);
const FIXTURES = join(HERE, ".cache", "fixtures");
mkdirSync(FIXTURES, { recursive: true });
const CHROME = process.env.CHROME_PATH || undefined;

// --- static server for the built app ---
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  const file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4319, "127.0.0.1", r));

// --- fixtures: the request without its time parameter identifies the answer ---
function fixtureKey(url) {
  const u = new URL(url);
  u.searchParams.delete("at");
  u.searchParams.sort();
  return createHash("sha1").update(u.pathname + "?" + u.searchParams).digest("hex").slice(0, 16);
}

const profile = join(HERE, ".cache", "profile");
rmSync(profile, { recursive: true, force: true });
const context = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 411, height: 914 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
  args: ["--disable-gpu-vsync"],
});
await context.route(/convex\.site/, async (route) => {
  const key = fixtureKey(route.request().url());
  const file = join(FIXTURES, key + ".json");
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    await route.fulfill({ status: saved.status, contentType: "application/json", body: saved.body, headers: { "access-control-allow-origin": "*" } });
    return;
  }
  const response = await route.fetch();
  const body = await response.text();
  writeFileSync(file, JSON.stringify({ url: route.request().url(), status: response.status(), body }));
  await route.fulfill({ status: response.status(), contentType: "application/json", body, headers: { "access-control-allow-origin": "*" } });
});

const page = context.pages()[0] ?? (await context.newPage());
const cdp = await context.newCDPSession(page);
let records = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (text.startsWith("NFPERF ")) records.push(JSON.parse(text.slice(7)));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function settle(waitMarks = [], timeout = 4000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const have = waitMarks.every((m) => records.some((r) => r.k === "mark" && r.name === m));
    if (have) break;
    await sleep(20);
  }
  await sleep(250); // trailing paints
}

async function step(name, action, waitMarks = []) {
  records = [];
  await action();
  await settle(waitMarks);
  results.push({ name, records });
}

const tap = (locator) => locator.first().tap();
async function typeSlow(text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(120);
  }
}

async function cold() {
  await step("kaltstart", async () => {
    await page.goto("http://127.0.0.1:4319/", { waitUntil: "load" });
  }, ["app-first-frame"]);
}

async function scenario(round) {
  const first = round === 0;
  await cold();
  await step("feld-start", () => tap(page.getByRole("button", { name: /^Start/ })));
  await step("tippen-start", () => typeSlow("Stuttgart"), ["places-shown"]);
  await step("waehlen-start", () => tap(page.locator(".row-main", { hasText: /^Stuttgart Hbf/ })));
  await step("feld-ziel", () => tap(page.getByRole("button", { name: /^Ziel/ })));
  await step("tippen-ziel", () => typeSlow("Heilbronn"), ["places-shown"]);
  await step("waehlen-ziel", () => tap(page.locator(".row-main", { hasText: /^Heilbronn Hbf/ })));
  await step("tauschen", () => tap(page.getByRole("button", { name: "Start und Ziel tauschen" })));
  await step("tauschen-zurueck", () => tap(page.getByRole("button", { name: "Start und Ziel tauschen" })));
  await step("segment-abfahrt", () => tap(page.getByRole("radio", { name: "Abfahrt" })));
  await step("segment-jetzt", () => tap(page.getByRole("radio", { name: "Jetzt" })));
  await step("erweitert-auf", () => tap(page.getByRole("button", { name: /Erweiterte Suche/ })));
  await step("erweitert-zu", () => tap(page.getByRole("button", { name: /Erweiterte Suche/ })));
  await step("suchen", () => tap(page.getByRole("button", { name: "Verbindungen suchen" })), ["journeys-shown"]);
  await step("karte-auf", () => tap(page.locator(".card-head")));
  await step("merken", () => tap(page.locator(".card-save")));
  await step("nicht-merken", () => tap(page.locator(".card-save")));
  await step("live", () => tap(page.getByRole("button", { name: "Live verfolgen" })), ["trip-shown"]);
  await step("zwischenhalte", () => tap(page.getByRole("button", { name: /Zwischenhalt/ })));
  await step("teilen", () => tap(page.getByRole("button", { name: "Teilen" })), ["share-image-ready"]);
  await step("teilen-zu", () => page.goBack());
  await step("live-zurueck", () => page.goBack());
  await step("karte-zu", () => tap(page.locator(".card-head")));
  await step("ergebnisse-zurueck", () => page.goBack());
  await step("gemerkt-oeffnen", () => tap(page.locator(".route-main").first()), ["trip-shown"]);
  await step("gemerkt-zurueck", () => page.goBack());
  await step("strecke-oeffnen", () => tap(page.locator("section", { hasText: "Deine Strecken" }).locator(".route-main")), ["journeys-shown"]);
  await step("strecke-zurueck", () => page.goBack());
  await step("picker-leer", () => tap(page.getByRole("button", { name: /^Start/ })));
  await step("favorit", () => tap(page.getByRole("button", { name: /Als Favorit speichern|Favorit entfernen/ })));
  await step("favorit-zurueck", () => tap(page.getByRole("button", { name: /Als Favorit speichern|Favorit entfernen/ })));
  await step("picker-zu", () => tap(page.getByRole("button", { name: "Schließen" })));
  if (first) console.error("round 0 done");
}

await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
for (let round = 0; round < ROUNDS; round++) {
  await scenario(round);
  // Keep saved connections bounded: forget everything the scenario saved.
  await page.evaluate(() => localStorage.removeItem("nf.saved.v1"));
}
writeFileSync(out, JSON.stringify({ cpu: CPU, rounds: ROUNDS, results }, null, 0));
await context.close();
server.close();
console.error(`wrote ${results.length} steps to ${out}`);
