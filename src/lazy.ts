import { useEffect, useState } from "preact/hooks";

/**
 * Screens that are not part of the start page are separate files. Their code then costs
 * nothing before the first frame; it arrives while the app is idle, so opening them stays
 * instant.
 */
const modules = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

export function loadModule<T>(name: string, importer: () => Promise<T>): Promise<T> {
  const known = modules.get(name) as T | undefined;
  if (known) return Promise.resolve(known);
  let task = pending.get(name) as Promise<T> | undefined;
  if (!task) {
    task = importer().then(
      (module) => {
        modules.set(name, module);
        pending.delete(name);
        return module;
      },
      (error) => {
        pending.delete(name);
        throw error;
      },
    );
    // A screen that is never opened must not leave an unhandled rejection behind.
    task.catch(() => undefined);
    pending.set(name, task);
  }
  return task;
}

export const loadedModule = <T>(name: string): T | undefined => modules.get(name) as T | undefined;

/**
 * The module once it is there. Loading starts when `wanted` turns true; a screen that was
 * already warmed up is returned in the same frame.
 */
export function useModule<T>(
  name: string,
  importer: () => Promise<T>,
  wanted = true,
): T | undefined {
  const [module, setModule] = useState<T | undefined>(() => loadedModule<T>(name));
  // The warm-up can finish long after this screen first rendered, so the cache is asked
  // again on every render. That way a warmed-up screen is part of the frame that opens it.
  const ready = module ?? loadedModule<T>(name);
  useEffect(() => {
    if (ready || !wanted) return;
    let alive = true;
    loadModule(name, importer).then(
      (next) => {
        if (alive) setModule(next);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
    // `importer` is a fresh arrow each render but always loads the same file.
  }, [name, ready, wanted]);
  return ready;
}
