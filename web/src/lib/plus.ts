import { useSyncExternalStore } from "react";

/**
 * "Is this visitor on vChat Plus?" for parts of the page outside the chat app's provider
 * (ad slots on every page). The chat app and the join form write it once they know.
 */
let plus = false;
const listeners = new Set<() => void>();

export function setPlus(value: boolean) {
  if (plus === value) return;
  plus = value;
  listeners.forEach((l) => l());
}

export function usePlus(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => plus,
    () => false,
  );
}
