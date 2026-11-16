"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchPush, pushSubscribe, pushUnsubscribe, savePushPrefs, type PushInfo, type PushPrefs } from "@/lib/api";

export type PushState = "unsupported" | "needs-install" | "default" | "granted" | "denied";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function currentState(): PushState {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  // iPhones get notifications only from vChat added to the Home Screen (iOS 16.4+).
  if (ios && !standalone) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission as PushState;
}

/** Notifications on this device: ask, subscribe, settings. */
export function usePush(getAccess: () => Promise<string>, signedIn: boolean) {
  const [state, setState] = useState<PushState>("unsupported");
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const subscribeHere = useCallback(
    async (publicKey: string) => {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await pushSubscribe(sub.toJSON(), await getAccess());
    },
    [getAccess],
  );

  // Load the server's settings; if this device already allowed notifications, make sure the
  // server knows it (a new login on a shared phone, keys that changed, a cleared subscription).
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const s = currentState();
    getAccess()
      .then(fetchPush)
      .then(async (res) => {
        if (cancelled) return;
        setInfo(res);
        setState(res.enabled ? s : "unsupported");
        if (res.enabled && s === "granted") await subscribeHere(res.public_key).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signedIn, getAccess, subscribeHere]);

  /** Must run from a tap: browsers only show the permission dialog then. */
  const enable = useCallback(async (): Promise<PushState> => {
    if (!info?.enabled) return "unsupported";
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setState(result as PushState);
      if (result === "granted") await subscribeHere(info.public_key);
      return result as PushState;
    } catch {
      return currentState();
    } finally {
      setBusy(false);
    }
  }, [info, subscribeHere]);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await pushUnsubscribe(sub.endpoint, await getAccess()).catch(() => undefined);
        await sub.unsubscribe();
      }
      setInfo((i) => (i ? { ...i, devices: Math.max(0, i.devices - 1) } : i));
    } finally {
      setBusy(false);
    }
  }, [getAccess]);

  const setPrefs = useCallback(
    async (change: Partial<PushPrefs>) => {
      setInfo((i) => (i ? { ...i, prefs: { ...i.prefs, ...change } } : i));
      const res = await savePushPrefs(change, await getAccess());
      setInfo((i) => (i ? { ...i, prefs: res.prefs } : i));
    },
    [getAccess],
  );

  return { state, info, busy, enable, disable, setPrefs };
}
