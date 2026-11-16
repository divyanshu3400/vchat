"use client";

import { useSyncExternalStore } from "react";

/**
 * Disappearing media seen (or heard) since the messages were loaded: attachment id -> views left.
 * Fed by "media.opened" socket events (both people get them) and by this device's own opens,
 * so the bubbles update without reloading the chat.
 */
const left = new Map<string, number>();
const listeners = new Set<() => void>();

export function noteOpened(id: string, viewsLeft: number) {
  left.set(id, Math.min(viewsLeft, left.get(id) ?? Infinity));
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Views left for this attachment: the newest of what the server sent and what happened since. */
export function useViewsLeft(id: string, fromServer: number): number {
  return useSyncExternalStore(
    subscribe,
    () => Math.min(fromServer, left.get(id) ?? fromServer),
    () => fromServer,
  );
}
