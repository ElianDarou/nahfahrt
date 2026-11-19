#!/usr/bin/env python3
"""App-independent timing of Nahfahrt and DB Navigator on an Android device or emulator.

Every app is measured the same way, from the outside: the screen is recorded with Android's
touch indicator switched on, then ffmpeg finds the frame in which the finger lands and the
frames in which the app's content changes. That needs no instrumentation inside the apps, so
the new Kotlin app, the old WebView app and DB Navigator are measured alike.

    ADB=emulator-adb AGENT_DEVICE=<agent-device command> scripts/visual-bench.py <new|old|db> <rounds> <out.json>

Per step it reports
  first   ms from the touch to the first change of the app's content
  settled ms from the touch until the content has not changed for QUIET_MS
  rx, tx  bytes the app received and sent during the step (Android's per-UID counters)
Cold start uses Android's own launch time (am start -W, first frame) instead of a touch.

Setup: start and destination must already be set to the route in each app, and the
destination station must be in the app's history so that typing finds it locally.
"""
import json, os, re, shlex, subprocess, sys, tempfile, time

ADB = shlex.split(os.environ.get("ADB", "adb"))
AGENT = shlex.split(os.environ.get("AGENT_DEVICE", "agent-device"))
QUIET_MS = 800
SCENE = 0.0015
STATUS_BAR = 100
NAV_BAR = 70

APPS = {
    "new": {"pkg": "io.github.eliandarou.nahfahrt", "search": r"^Verbindungen suchen$", "field": r"^Start:", "back_to_home": 1},
    "old": {"pkg": "io.github.eliandarou.nahfahrt", "search": r"^Stuttgart Hbf → Heilbronn", "field": r"^Start ", "back_to_home": 1},
    "db": {"pkg": "de.hafas.android.db", "search": r"^Suchen$", "field": r"^Stuttgart Hbf$", "back_to_home": 2},
}


def adb(*args, check=False):
    # adb shell reads its standard input; an inherited open pipe would make it wait forever.
    return subprocess.run([*ADB, *args], capture_output=True, text=True, check=check, stdin=subprocess.DEVNULL)


def nodes():
    """Accessibility nodes through agent-device: uiautomator dump waits for an idle screen,
    which apps with endless animations (DB Navigator) never reach."""
    out = subprocess.run([*AGENT, "snapshot", "--json"], capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout
    try:
        return json.loads(out)["data"]["nodes"]
    except (ValueError, KeyError):
        return []


def label(node):
    return node.get("label") or node.get("value") or ""


def bounds(node):
    r = node["rect"]
    return r["x"], r["y"], r["x"] + r["width"], r["y"] + r["height"]


def find(pattern, tries=12, pick=lambda n: True):
    rx = re.compile(pattern)
    for _ in range(tries):
        found = [n for n in nodes() if "rect" in n and rx.search(label(n)) and pick(n)]
        if found:
            return found
        time.sleep(0.7)
    raise RuntimeError("not found: " + pattern)


def centre(node):
    x1, y1, x2, y2 = bounds(node)
    return (x1 + x2) // 2, (y1 + y2) // 2


def screen_size():
    m = re.search(r"(\d+)x(\d+)", adb("shell", "wm", "size").stdout)
    return int(m.group(1)), int(m.group(2))


def app_uid(pkg):
    out = adb("shell", f"pm list packages -U {pkg}").stdout
    return re.search(r"uid:(\d+)", out).group(1)


def traffic(uid):
    out = adb("shell", "dumpsys netstats detail").stdout
    if "mAppUidStatsMap:" not in out:
        return 0, 0
    section = out.rsplit("mAppUidStatsMap:", 1)[1].split("mStatsMapA", 1)[0]
    for line in section.splitlines():
        p = line.split()
        if len(p) == 5 and p[0] == uid:
            return int(p[1]), int(p[3])
    return 0, 0


def change_times(video, box):
    """Timestamps (s) of frames whose content inside box differs from the frame before."""
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    if w < 8 or h < 8:
        return []
    graph = f"crop={w}:{h}:{x1}:{y1},select='gt(scene\\,{SCENE})',showinfo"
    out = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", video, "-vf", graph, "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return [float(m) for m in re.findall(r"pts_time:([0-9.]+)", out)]


def touch_time(video, x, y):
    times = change_times(video, (max(0, x - 24), max(0, y - 24), x + 24, y + 24))
    return times[0] if times else None


def analyse(video, tap, width, height, t0=None):
    """first and settled in ms after the touch (or after t0 when given)."""
    if t0 is None:
        t0 = touch_time(video, *tap)
        if t0 is None:
            return None
    ty = tap[1] if tap else -1000
    # The touch indicator itself must not count as a response: the band around it is left out.
    regions = [(0, STATUS_BAR, width, max(STATUS_BAR, ty - 40)), (0, min(height - NAV_BAR, ty + 40), width, height - NAV_BAR)]
    if tap is None:
        regions = [(0, STATUS_BAR, width, height - NAV_BAR)]
    # A change in the very frame that shows the touch is a response within that frame: some
    # screens are drawn before the touch indicator gets a frame of its own.
    times = sorted({t for r in regions for t in change_times(video, r) if t >= t0 - 0.0005})
    if not times:
        return {"first": None, "settled": None}
    settled = times[0]
    for previous, current in zip(times, times[1:] + [None]):
        settled = previous
        if current is None or current - previous > QUIET_MS / 1000:
            break
    return {"first": round((times[0] - t0) * 1000), "settled": round((settled - t0) * 1000)}


def record(command, seconds):
    """Records the screen while `command` runs on the device; returns the local video path.
    Recording, input and stop are one shell call on the device: the emulator pool locks the
    device for the duration of every adb command, so a separate input call would wait."""
    script = (f"rm -f /sdcard/bench.mp4; screenrecord --bit-rate 6000000 /sdcard/bench.mp4 & "
              f"sleep 1.5; {command}; sleep {seconds}; pkill -INT screenrecord; wait; sleep 0.3")
    adb("shell", script)
    local = tempfile.mktemp(suffix=".mp4", dir="/tmp")
    adb("pull", "/sdcard/bench.mp4", local)
    return local


def main():
    app, rounds, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    cfg = APPS[app]
    pkg = cfg["pkg"]
    width, height = screen_size()
    uid = app_uid(pkg)
    adb("shell", "settings", "put", "system", "show_touches", "1")
    results = []

    def measured(name, tap_node=None, seconds=6.0, type_text=None, field_node=None):
        before = traffic(uid)
        if type_text is not None:
            box = bounds(field_node)
            video = record(f"input text {type_text}", seconds)
            echo = change_times(video, box)
            result = analyse(video, None, width, height, t0=echo[0]) if echo else None
            tap = None
        else:
            tap = centre(tap_node)
            video = record(f"input tap {tap[0]} {tap[1]}", seconds)
            result = analyse(video, tap, width, height)
        after = traffic(uid)
        os.remove(video)
        entry = {"step": name, **(result or {"first": None, "settled": None}), "rx": after[0] - before[0], "tx": after[1] - before[1]}
        print(app, entry, flush=True)
        results.append(entry)

    def back(times):
        for _ in range(times):
            adb("shell", "input", "keyevent", "KEYCODE_BACK")
            time.sleep(1.2)

    for round_index in range(rounds):
        # Cold start: Android's own measurement up to the first frame.
        adb("shell", "am", "force-stop", pkg)
        time.sleep(1.5)
        activity = adb("shell", "cmd", "package", "resolve-activity", "--brief", pkg).stdout.strip().split()[-1]
        start = adb("shell", "am", "start", "-W", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-n", activity).stdout
        total = re.search(r"TotalTime: (\d+)", start)
        results.append({"step": "cold-start", "first": int(total.group(1)) if total else None})
        print(app, results[-1], flush=True)
        time.sleep(4)

        # Search, from the start page with start and destination set.
        measured("search", find(cfg["search"])[0], seconds=8)
        # The first connection of the results.
        rows = find(r"^\d{1,2}:\d{2}", pick=lambda n: bounds(n)[1] > 250)
        measured("open-connection", rows[0], seconds=4)
        back(cfg["back_to_home"])
        time.sleep(1)

        # Station search: open it, then type the start of a station that is in the history.
        measured("open-station-search", find(cfg["field"])[0], seconds=3)
        fields = [n for n in nodes() if "rect" in n and n.get("type", "").endswith("EditText")]
        field = fields[0]
        measured("type-station", seconds=4, type_text="Heil", field_node=field)
        back(2)
        time.sleep(1)

    adb("shell", "settings", "put", "system", "show_touches", "0")
    with open(out_path, "w") as handle:
        json.dump({"app": app, "results": results}, handle, indent=1)


if __name__ == "__main__":
    main()
