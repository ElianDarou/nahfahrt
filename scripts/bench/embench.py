#!/usr/bin/env python3
"""In-app benchmark on an Android device or emulator: every interaction of Nahfahrt, timed by the
app's own NFPERF lines (bench build: VITE_BENCH=1 and NF_BENCH=1, see README "Leistung messen").

scripts/bench/embench.py <out.json> [rounds]
ADB="emulator-adb" scripts/bench/embench.py ...   # any adb-compatible command, default "adb"

Per step it stores the NFPERF records, launch events (for starts) and the bytes the app sent and
received (Android's per-UID BPF counters, so everything on the wire including TLS).
"""
import json, os, re, shlex, subprocess, sys, time
import xml.etree.ElementTree as ET

ADB = shlex.split(os.environ.get("ADB", "adb"))
PKG = "io.github.eliandarou.nahfahrt"
COMP = PKG + "/.MainActivity"
LAUNCH = f"am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n {COMP}"


def adb(*args):
    return subprocess.run([*ADB, *args], capture_output=True, text=True)


def nodes():
    for _ in range(5):
        adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/ui.xml")
        out = subprocess.run([*ADB, "exec-out", "cat", "/sdcard/ui.xml"], capture_output=True).stdout
        try:
            return list(ET.fromstring(out).iter("node"))
        except ET.ParseError:
            time.sleep(1)
    return []


def label(n):
    return (n.get("text") or "") + "|" + (n.get("content-desc") or "")


def centre(n):
    a = list(map(int, re.findall(r"\d+", n.get("bounds"))))
    return (a[0] + a[2]) // 2, (a[1] + a[3]) // 2


def app_uid():
    out = adb("shell", f"pm list packages -U {PKG}").stdout
    return re.search(r"uid:(\d+)", out).group(1)


def traffic(uid):
    """(rx, tx) bytes of the app so far, from the live per-UID counters."""
    out = adb("shell", "dumpsys netstats detail").stdout
    section = out.rsplit("mAppUidStatsMap:", 1)[1].split("mStatsMapA", 1)[0]
    for line in section.splitlines():
        p = line.split()
        if len(p) == 5 and p[0] == uid:
            return int(p[1]), int(p[3])
    return 0, 0


UID = None


def find(pattern, tries=10, pick=None):
    rx = re.compile(pattern)
    for _ in range(tries):
        found = [n for n in nodes() if rx.search(label(n))]
        if pick:
            found = [n for n in found if pick(n)]
        if found:
            return found
        time.sleep(0.7)
    raise RuntimeError("not found: " + pattern)


def perf_lines():
    out = adb("logcat", "-d", "-v", "epoch").stdout
    recs, starts = [], []
    for line in out.splitlines():
        i = line.find("NFPERF ")
        if i >= 0:
            try:
                recs.append(json.loads(line[i + 7:].rstrip().rstrip('"')))
            except json.JSONDecodeError:
                pass
        m = re.match(r"\s*([0-9.]+)\s.*ActivityTaskManager: START u0 .*cmp=" + re.escape(PKG), line)
        if m:
            starts.append(float(m.group(1)))
        m = re.match(r"\s*([0-9.]+)\s.*Displayed " + re.escape(PKG) + r"/\S+.*\+(?:(\d+)s)?(\d+)ms", line)
        if m:
            recs.append({"k": "displayed", "ms": int(m.group(2) or 0) * 1000 + int(m.group(3))})
    return recs, starts


RESULTS = []


def step(name, action, wait=1.5):
    adb("logcat", "-c")
    before = traffic(UID)
    extra = action()
    extra = extra if isinstance(extra, dict) else {}
    time.sleep(wait)
    after = traffic(UID)
    recs, starts = perf_lines()
    RESULTS.append({"name": name, "records": recs, "launch_starts": starts, "rx": after[0] - before[0],
                    "tx": after[1] - before[1], **extra})


def tap(pattern, pick=None, index=0):
    n = find(pattern, pick=pick)[index]
    x, y = centre(n)
    return lambda: adb("shell", f"input tap {x} {y}")


def do(pattern, pick=None, index=0):
    return tap(pattern, pick, index)()


def launch():
    out = adb("shell", LAUNCH).stdout
    state = (re.search(r"LaunchState: (\w+)", out) or [None, None])[1]
    total = int((re.search(r"TotalTime: (\d+)", out) or [None, -1])[1])
    return {"launch_state": state, "total_ms": total}


def type_word(word):
    # One adb call per character: about 100-150 ms apart, like real typing.
    def run():
        for ch in word:
            adb("shell", f"input text {ch}")
    return run


def is_button(n):
    return n.get("class", "").endswith("Button")


def round_(r):
    adb("shell", f"am force-stop {PKG}; input keyevent KEYCODE_HOME")
    time.sleep(2)
    step("kaltstart", launch, wait=4)
    find(r"^Verbindungen suchen")
    step("leer-tap", tap(r"^Nahfahrt\|"))
    step("feld-start", tap(r"^Start(?! und)", pick=is_button))
    step("tippen-start", type_word("Stuttgart"), wait=3)
    step("waehlen-start", tap(r"^Stuttgart Hbf\|"))
    step("feld-ziel", tap(r"^Ziel\b", pick=is_button))
    step("tippen-ziel", type_word("Heilbronn"), wait=3)
    step("waehlen-ziel", tap(r"^Heilbronn Hbf\|"))
    step("tauschen", tap(r"Start und Ziel tauschen"))
    step("tauschen-zurueck", tap(r"Start und Ziel tauschen"))
    step("segment-abfahrt", tap(r"^Abfahrt\|"))
    step("segment-jetzt", tap(r"^Jetzt\|"))
    step("erweitert-auf", tap(r"^Erweiterte Suche"))
    step("erweitert-zu", tap(r"^Erweiterte Suche"))
    step("suchen", tap(r"^Verbindungen suchen"), wait=4)
    step("karte-auf", tap(r"Min\. · ", pick=is_button))
    step("merken", tap(r"Verbindung merken|Nicht mehr merken", pick=lambda n: n.get("class", "").endswith("ToggleButton")))
    step("nicht-merken", tap(r"Verbindung merken|Nicht mehr merken", pick=lambda n: n.get("class", "").endswith("ToggleButton")))
    step("live", tap(r"^Live verfolgen"), wait=4)
    step("zwischenhalte", tap(r"Zwischenhalt"))
    step("teilen", tap(r"^Teilen\|"), wait=3)
    step("teilen-zu", lambda: adb("shell", "input keyevent KEYCODE_BACK"))
    step("live-zurueck", lambda: adb("shell", "input keyevent KEYCODE_BACK"))
    step("karte-zu", tap(r"Min\. · ", pick=is_button))
    step("ergebnisse-zurueck", lambda: adb("shell", "input keyevent KEYCODE_BACK"))
    step("gemerkt-oeffnen", tap(r"→ Heilbronn Hbf.*\d\d:\d\d", pick=is_button), wait=4)
    step("gemerkt-zurueck", lambda: adb("shell", "input keyevent KEYCODE_BACK"))
    step("strecke-oeffnen", tap(r"^Stuttgart Hbf → Heilbronn Hbf\|?$", pick=is_button), wait=4)
    step("strecke-zurueck", lambda: adb("shell", "input keyevent KEYCODE_BACK"))
    step("picker-leer", tap(r"^Start(?! und)", pick=is_button))
    step("favorit", tap(r"Als Favorit speichern|Favorit entfernen"))
    step("favorit-zurueck", tap(r"Als Favorit speichern|Favorit entfernen"))
    step("picker-zu", tap(r"^Schließen|\|Schließen"))
    adb("shell", "input keyevent KEYCODE_HOME")
    time.sleep(2)
    step("warmstart", launch, wait=2)
    # Saved connections pile up otherwise: forget the newest one again.
    try:
        do(r"^Nicht mehr merken", pick=is_button)
    except RuntimeError:
        pass


def main():
    global UID
    UID = app_uid()
    out = sys.argv[1]
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    for r in range(rounds):
        try:
            round_(r)
        except Exception as error:  # keep what was measured, mark the round
            RESULTS.append({"name": "FEHLER", "error": str(error), "round": r})
            print("round", r, "failed:", error, flush=True)
        print("round", r, "done", flush=True)
        json.dump({"results": RESULTS}, open(out, "w"))


if __name__ == "__main__":
    main()
