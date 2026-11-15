// node scripts/bench/host-analyze.mjs <bench.json> [<baseline.json>] : per interaction p50 / p95 / max, against the targets.
import { readFileSync } from "node:fs";

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const quant = (v, q) => {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i];
};

// Metrics of one recorded step: name -> list of values (ms).
function metrics(step) {
  const r = step.records;
  const inputs = r.filter((x) => x.k === "input");
  const marks = r.filter((x) => x.k === "mark");
  const out = {};
  const add = (k, v) => (out[k] ??= []).push(v);
  const firstDown = inputs.find((x) => x.type === "pointerdown");
  const clicks = inputs.filter((x) => x.type === "click");
  const pops = inputs.filter((x) => x.type === "popstate");
  if (step.name === "kaltstart") {
    const boot = r.find((x) => x.k === "boot");
    const first = marks.find((x) => x.name === "app-first-frame");
    if (first) add("start→erstes Bild", first.painted);
    if (boot) add("start→Skript", boot.scriptStart);
    const fcp = r.find((x) => x.k === "paint" && x.name === "first-contentful-paint");
    if (fcp) add("FCP", fcp.at);
  } else if (step.name.startsWith("tippen")) {
    const keys = inputs.filter((x) => x.type === "input");
    for (const k of keys) add("Taste→Bild", k.latency);
    const lastKey = keys[keys.length - 1];
    for (const m of marks.filter((x) => x.name === "places-shown")) {
      if (lastKey && m.at >= lastKey.start) add(`Treffer (Netz${m.cached ? ", Sitzungscache" : ""})`, m.painted - lastKey.start);
    }
  } else if (firstDown && clicks.length) {
    // Like INP: from lifting the finger (pointerup) to the frame that shows the response.
    const click = clicks[clicks.length - 1];
    const up = inputs.filter((x) => x.type === "pointerup").pop() ?? firstDown;
    add("Tipp→Bild", click.painted - up.start);
  } else if (pops.length) {
    add("Zurück→Bild", pops[0].latency);
  }
  const t0 = (inputs.filter((x) => x.type === "pointerup").pop() ?? firstDown)?.start ?? pops[0]?.start;
  for (const m of marks) {
    if (m.name === "places-shown" || m.name === "app-first-frame" || t0 === undefined) continue;
    add(m.name, m.painted - t0);
  }
  for (const lt of r.filter((x) => x.k === "longtask")) add("longtask", lt.duration);
  return out;
}

function summarize(file) {
  const data = load(file);
  const table = new Map();
  for (const step of data.results) {
    for (const [k, vals] of Object.entries(metrics(step))) {
      const key = `${step.name} | ${k}`;
      if (!table.has(key)) table.set(key, []);
      table.get(key).push(...vals);
    }
  }
  return { data, table };
}

const cur = summarize(process.argv[2]);
const base = process.argv[3] ? summarize(process.argv[3]) : undefined;
console.log(`CPU x${cur.data.cpu}, ${cur.data.rounds} Runden`);
const target = (key, p50) => {
  if (key.includes("longtask")) return "";
  if (key.includes("journeys") || key.includes("trip") || key.includes("Netz)")) return "Netz";
  if (key.startsWith("kaltstart")) return p50 <= 500 ? "OK" : "über 500";
  return p50 <= 50 ? "OK" : "über 50";
};
for (const [key, vals] of cur.table) {
  const p50 = quant(vals, 0.5), p95 = quant(vals, 0.95), max = Math.max(...vals);
  let line = `${key.padEnd(48)} n=${String(vals.length).padStart(3)}  p50 ${p50.toFixed(1).padStart(7)}  p95 ${p95.toFixed(1).padStart(7)}  max ${max.toFixed(1).padStart(7)}`;
  if (base?.table.has(key)) {
    const b = quant(base.table.get(key), 0.5);
    line += `   (vorher p50 ${b.toFixed(1)})`;
  }
  console.log(line + "  " + target(key, p50));
}
