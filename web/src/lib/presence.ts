import { useSyncExternalStore } from "react";
import { fetchRoomPresence, type RoomPresence } from "./api";

// One shared poller for live counts, however many components show them.
const POLL_MS = 30_000;

let snapshot: RoomPresence | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const subscribers = new Set<() => void>();

async function poll() {
  try {
    snapshot = await fetchRoomPresence();
    subscribers.forEach((notify) => notify());
  } catch {
    /* keep the last numbers; try again next tick */
  }
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    poll();
    timer = setInterval(poll, POLL_MS);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) clearInterval(timer);
  };
}

/** Fetch fresh counts now (e.g. right after joining a room) instead of waiting for the next tick. */
export function refreshRoomPresence() {
  if (subscribers.size > 0) poll();
}

export function useRoomPresence(): RoomPresence | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  );
}
