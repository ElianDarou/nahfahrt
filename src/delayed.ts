import { useEffect, useState } from "preact/hooks";

/** Waiting shorter than this needs no spinner, and an animation costs frames and battery. */
export const SPINNER_DELAY_MS = 300;

/** True once `active` has been true for `delay` milliseconds; false as soon as it ends. */
export function useDelayed(active: boolean, delay = SPINNER_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [active, delay]);
  return active && shown;
}
