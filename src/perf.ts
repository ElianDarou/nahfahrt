/**
 * Benchmark instrumentation. Only active in builds made with VITE_BENCH=1; otherwise every
 * function is an empty stub that the minifier removes.
 *
 * Each record is one console line "NFPERF {json}". Times are performance.now() milliseconds,
 * so they share the clock of event.timeStamp (the moment the input reached the page).
 */
export const BENCH = import.meta.env.VITE_BENCH === "1";

type Record_ = { k: string; [field: string]: unknown };

const round = (value: number): number => Math.round(value * 10) / 10;

function emit(record: Record_): void {
  console.info("NFPERF " + JSON.stringify(record));
}

/** Calls back once the frame that shows the current DOM has been produced. */
export function afterNextPaint(callback: (time: number) => void): void {
  requestAnimationFrame(() => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => callback(performance.now());
    channel.port2.postMessage(0);
  });
}

function describe(target: EventTarget | null): string {
  if (!(target instanceof Element)) return "";
  const element = target.closest("button, a, input, textarea, select, [role]") ?? target;
  const label =
    element.getAttribute("aria-label") ||
    (element instanceof HTMLInputElement ? element.type : "") ||
    (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return `${element.tagName.toLowerCase()}${element.className ? "." + String(element.className).split(" ")[0] : ""}:${label}`;
}

/** Marks the moment something the user waits for is on screen (after the next frame). */
export function mark(name: string, detail?: Record<string, unknown>): void {
  if (!BENCH) return;
  const at = performance.now();
  afterNextPaint((painted) => emit({ k: "mark", name, at: round(at), painted: round(painted), ...detail }));
}

const INPUT_EVENTS = ["pointerdown", "pointerup", "click", "keydown", "input", "change", "submit", "popstate"];

export function initPerf(): void {
  if (!BENCH) return;
  emit({
    k: "boot",
    timeOrigin: performance.timeOrigin,
    scriptStart: round(performance.now()),
    nav: (() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return nav
        ? { responseEnd: round(nav.responseEnd), domInteractive: round(nav.domInteractive), dcl: round(nav.domContentLoadedEventEnd) }
        : undefined;
    })(),
  });

  // Every input, whatever it does: from the input's timestamp to the next produced frame.
  for (const type of INPUT_EVENTS) {
    window.addEventListener(
      type,
      (event) => {
        const start = event.timeStamp;
        const handled = performance.now();
        const target = describe(event.target);
        afterNextPaint((painted) =>
          emit({ k: "input", type, target, start: round(start), queued: round(handled - start), painted: round(painted), latency: round(painted - start) }),
        );
      },
      { capture: true, passive: true },
    );
  }

  // Coming back from the background: from the visibility change to the next frame.
  document.addEventListener("visibilitychange", (event) => {
    if (document.hidden) return;
    const start = event.timeStamp;
    afterNextPaint((painted) => emit({ k: "input", type: "resume", target: "", start: round(start), queued: 0, painted: round(painted), latency: round(painted - start) }));
  });

  // The browser's own view of slow interactions (16 ms and more, 8 ms resolution).
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        emit({
          k: "event-timing",
          type: entry.name,
          id: entry.interactionId,
          start: round(entry.startTime),
          duration: entry.duration,
          processing: round(entry.processingEnd - entry.processingStart),
          delay: round(entry.processingStart - entry.startTime),
          target: describe(entry.target ?? null),
        });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  } catch {
    // Not supported: the input records above still cover every interaction.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        emit({ k: "longtask", start: round(entry.startTime), duration: round(entry.duration) });
      }
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) emit({ k: "paint", name: entry.name, at: round(entry.startTime) });
    }).observe({ type: "paint", buffered: true });
  } catch {
    // Optional.
  }
}

/** Network requests: time and bytes on the wire as the WebView reports them. */
export function logFetch(path: string, started: number, response?: Response): void {
  if (!BENCH) return;
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const timing = [...entries].reverse().find((entry) => entry.name.includes(path));
  emit({
    k: "fetch",
    path,
    started: round(started),
    done: round(performance.now()),
    status: response?.status,
    transfer: timing?.transferSize,
    body: timing?.encodedBodySize,
    connect: timing ? round(timing.connectEnd - timing.connectStart) : undefined,
    tls: timing && timing.secureConnectionStart > 0 ? round(timing.connectEnd - timing.secureConnectionStart) : undefined,
    ttfb: timing ? round(timing.responseStart - timing.requestStart) : undefined,
  });
}
