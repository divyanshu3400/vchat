"use client";

import { useSyncExternalStore } from "react";

/**
 * Profile photo links by user id: yours and your friends' (the server gives no one else's).
 * ChatProvider fills it from "me" and the friends list; <Avatar id=...> reads it, so a friend's
 * photo shows wherever they appear without every screen passing it down.
 */
let photos = new Map<number, string>();
const listeners = new Set<() => void>();

export function setAvatarPhotos(entries: [number, string | null | undefined][]) {
  const next = new Map<number, string>();
  for (const [id, url] of entries) if (url) next.set(id, url);
  if (next.size === photos.size && [...next].every(([id, url]) => photos.get(id) === url)) return;
  photos = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAvatarPhoto(id: number | undefined): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (id === undefined ? undefined : photos.get(id)),
    () => undefined,
  );
}
