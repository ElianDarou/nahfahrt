#!/usr/bin/env node
/**
 * Compares the deployed API against connections recorded by hand on bahn.de
 * (filter "Nur D-Ticket-Verbindungen") on 6 November 2026.
 *
 * Usage: API_URL=https://<deployment>.convex.site npm run compare
 *
 * Timetables change, so this only makes sense for the recorded dates.
 */
import { existsSync, readFileSync } from "node:fs";

const API_URL = process.env.API_URL;
if (!API_URL) {
  console.error("Please set API_URL to the .convex.site URL of a deployment.");
  process.exit(2);
}

const MANNHEIM = { place: "de-DELFI_de:08222:2417_G" };
const KROZINGEN = { place: "de-DELFI_de:08315:6501_G_G" };

/** Own routes can go into scripts/compare-cases.local.json, which git ignores. */
const LOCAL_CASES = new URL("./compare-cases.local.json", import.meta.url);
const CASES = existsSync(LOCAL_CASES)
  ? JSON.parse(readFileSync(LOCAL_CASES, "utf8"))
  : [
      {
        name: "Mannheim → Bad Krozingen, Mo 17:00",
        from: MANNHEIM,
        to: KROZINGEN,
        at: "2026-11-09T16:00:00Z",
        expected: ["17:19-20:27", "17:59-21:41", "18:53-22:27", "19:53-23:50", "19:53-23:55"],
      },
      {
        name: "Bad Krozingen → Mannheim, Mo 07:00",
        from: KROZINGEN,
        to: MANNHEIM,
        at: "2026-11-09T06:00:00Z",
        expected: ["07:24-11:08", "08:35-12:05", "09:33-13:08", "10:32-14:01", "11:34-15:01"],
      },
    ];

const clock = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Berlin",
});
const hhmm = (minutes) => clock.format(minutes * 60000);
const toMinutes = (text) => Number(text.slice(0, 2)) * 60 + Number(text.slice(3));

function isClose(expected, actual) {
  return [0, 1].every((index) => {
    const difference = Math.abs(
      toMinutes(expected.split("-")[index]) - toMinutes(actual.split("-")[index]),
    );
    return Math.min(difference, 1440 - difference) <= 1;
  });
}

let matched = 0;
let total = 0;
let bytes = 0;
for (const { name, from, to, at, expected } of CASES) {
  const query = new URLSearchParams({ from: from.place, to: to.place, at });
  if (from.type) query.set("fromType", from.type);
  if (to.type) query.set("toType", to.type);
  const response = await fetch(`${API_URL}/v1/journeys?${query}`);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const text = await response.text();
  bytes += text.length;
  const { j: journeys } = JSON.parse(text);
  const found = journeys.map((journey) => {
    const vehicles = journey.l.filter((leg) => leg.m !== "W");
    return `${hhmm(vehicles[0].a)}-${hhmm(vehicles[vehicles.length - 1].b)}`;
  });
  const hits = expected.filter((item) => found.some((candidate) => isClose(item, candidate)));
  const missing = expected.filter((item) => !hits.includes(item));
  const extra = found.filter((item) => !expected.some((candidate) => isClose(candidate, item)));
  matched += hits.length;
  total += expected.length;
  console.log(`${hits.length}/${expected.length}  ${name}`);
  if (missing.length) console.log(`      fehlt:     ${missing.join(", ")}`);
  if (extra.length) console.log(`      zusätzlich: ${extra.join(", ")}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.log(`\nGesamt ${matched}/${total}, Ø ${Math.round(bytes / CASES.length)} Bytes JSON je Suche (vor gzip)`);
process.exit(matched / total >= 0.9 ? 0 : 1);
