#!/usr/bin/env python3
"""scripts/bench/emanalyze.py <embench.json> [baseline.json] : per step p50/max of
 - "Anzeige": Event Timing duration of each interaction (input -> frame on screen), the main metric
 - "App": input -> frame produced by the app (rAF + message), i.e. the app's own work
 - marks (network results, share image) from the triggering input, and bytes per step."""
import json, statistics, sys
from collections import defaultdict


def collect(path):
    out = defaultdict(lambda: defaultdict(list))
    for s in json.load(open(path))["results"]:
        if s["name"] == "FEHLER":
            continue
        rs = s.get("records", [])
        name = s["name"]
        by_id = defaultdict(int)
        for r in rs:
            if r["k"] == "event-timing" and r.get("id"):
                by_id[r["id"]] = max(by_id[r["id"]], r["duration"])
        for v in by_id.values():
            out[name]["Anzeige"].append(v)
        inputs = [r for r in rs if r["k"] == "input"]
        resp = [r for r in inputs if r["type"] in ("click", "input", "popstate")]
        for r in resp:
            out[name]["App"].append(r["latency"])
        up = [r for r in inputs if r["type"] in ("pointerup", "popstate")]
        keys = [r for r in inputs if r["type"] == "input"]
        t0 = (up[-1]["start"] if up else (keys[-1]["start"] if keys else None))
        for m in [r for r in rs if r["k"] == "mark"]:
            if m["name"] == "app-first-frame":
                out[name]["erstes Bild (ab timeOrigin)"].append(m["painted"])
            elif t0 is not None and m["at"] >= t0 - 1:
                out[name][m["name"]].append(m["painted"] - t0)
        for r in rs:
            if r["k"] == "paint" and r["name"] == "first-contentful-paint":
                out[name]["FCP (ab timeOrigin)"].append(r["at"])
            if r["k"] == "boot" and s.get("launch_starts"):
                out[name]["nativ bis timeOrigin"].append(r["timeOrigin"] - s["launch_starts"][-1] * 1000)
            if r["k"] == "displayed":
                out[name]["Android Displayed"].append(r["ms"])
        if "total_ms" in s and s["total_ms"] >= 0:
            out[name]["am TotalTime"].append(s["total_ms"])
        out[name]["Bytes"].append(s.get("rx", 0) + s.get("tx", 0))
    return out


cur = collect(sys.argv[1])
base = collect(sys.argv[2]) if len(sys.argv) > 2 else None
floor = statistics.median(cur["leer-tap"]["Anzeige"]) if cur["leer-tap"]["Anzeige"] else None
print(f"Sockel (Leer-Tap, Anzeige p50): {floor}")
for step, metrics in cur.items():
    for k, v in metrics.items():
        if not v:
            continue
        p50 = statistics.median(v)
        line = f"{step:20s} {k:28s} n={len(v):3d} p50 {p50:8.1f} max {max(v):8.1f}"
        if base and base.get(step, {}).get(k):
            line += f"   vorher p50 {statistics.median(base[step][k]):8.1f}"
        print(line)
