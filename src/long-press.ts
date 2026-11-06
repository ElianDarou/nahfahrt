import { useRef } from "preact/hooks";

const HOLD_MS = 500;
const MOVE_TOLERANCE = 10;

/** Handlers for an element that does one thing on a tap and another when held. */
export function useLongPress(onHold: () => void, onTap?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancel = () => clearTimeout(timer.current);

  return {
    onPointerDown: (event: PointerEvent) => {
      held.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      cancel();
      timer.current = setTimeout(() => {
        held.current = true;
        onHold();
      }, HOLD_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      const moved = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y);
      if (moved > MOVE_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Android's own menu for a held element would cover ours.
    onContextMenu: (event: Event) => event.preventDefault(),
    onClick: () => {
      if (!held.current) onTap?.();
      held.current = false;
    },
  };
}
