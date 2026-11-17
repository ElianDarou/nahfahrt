/**
 * Shares identical requests and keeps their answers for a short while.
 *
 * While a request runs, every caller with the same key waits on the same promise. Afterwards
 * the answer serves until it expires. That makes prefetching worth something: the request the
 * user triggers with a tap is the one that already left, not a second one.
 */
export class RequestCache<T> {
  private readonly entries = new Map<string, { at: number; value?: T; task?: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    /** Keeps a long session from growing without bound. */
    private readonly limit = 24,
  ) {}

  /** The answer, if it is still fresh. */
  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.value === undefined) return undefined;
    if (now - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Answers from the cache, or starts `load` once for everyone with this key. */
  run(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    const known = this.get(key, now);
    if (known !== undefined) return Promise.resolve(known);
    const running = this.entries.get(key)?.task;
    if (running) return running;

    const task = load().then(
      (value) => {
        this.entries.delete(key);
        this.entries.set(key, { at: now, value });
        this.trim();
        return value;
      },
      (error) => {
        // A failure is not an answer: the next caller may try again.
        this.entries.delete(key);
        throw error;
      },
    );
    // A prefetch, or every caller that aborted, must not leave an unhandled rejection behind.
    task.catch(() => undefined);
    this.entries.set(key, { at: now, task });
    return task;
  }

  private trim(): void {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

/** Rejects when the caller aborts, while the shared request keeps running for the cache. */
export function untilAborted<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", stop);
        reject(error);
      },
    );
  });
}
