import { useSyncExternalStore } from "react";

/** Below the `shell` breakpoint (60rem): the phone layout with the green app bar and bottom navigation. */
const PHONE_QUERY = "(max-width: 59.99rem)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True on phone-sized screens. Pages use it to render their phone layout
 * instead of mounting both layouts and hiding one (which would fetch twice).
 * The server render assumes desktop; the client corrects it on hydration.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
