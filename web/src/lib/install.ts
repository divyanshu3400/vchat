"use client";

import { useCallback, useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type W = Window & { __vchatInstall?: InstallEvent | null };

export type Platform = "ios" | "android" | "desktop";

function detect() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const platform: Platform = ios ? "ios" : /Android/.test(ua) ? "android" : "desktop";
  // Instagram, Facebook, Snapchat, LinkedIn… open links in their own browser, which can't install.
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|Snapchat|Line\/|LinkedInApp|TikTok|musical_ly/i.test(ua);
  const iosNotSafari = ios && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  let remembered = false;
  try {
    remembered = localStorage.getItem("vchat.installed") === "1";
  } catch {
    /* private mode */
  }
  return { platform, inApp, iosNotSafari, standalone, installed: standalone || remembered };
}

/** Can vChat be installed here, and how. */
export function useInstall() {
  const [info, setInfo] = useState<ReturnType<typeof detect> | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);

  useEffect(() => {
    const update = () => {
      setInfo(detect());
      setCanPrompt(!!(window as W).__vchatInstall);
    };
    update();
    window.addEventListener("vchat-installable", update);
    window.addEventListener("appinstalled", update);
    return () => {
      window.removeEventListener("vchat-installable", update);
      window.removeEventListener("appinstalled", update);
    };
  }, []);

  /** Chrome/Edge/Samsung: the browser's own install dialog. Returns true if installed. */
  const prompt = useCallback(async () => {
    const ev = (window as W).__vchatInstall;
    if (!ev) return false;
    await ev.prompt();
    const choice = await ev.userChoice;
    (window as W).__vchatInstall = null;
    setCanPrompt(false);
    if (choice.outcome === "accepted") {
      try {
        localStorage.setItem("vchat.installed", "1");
      } catch {
        /* private mode */
      }
      setInfo((i) => (i ? { ...i, installed: true } : i));
      return true;
    }
    return false;
  }, []);

  return { info, canPrompt, prompt };
}

// --- when to suggest it: never on the first visit, after something good happened -------------

const NUDGE_KEY = "vchat.nudge."; // + name -> time it was last dismissed
const SNOOZE_MS = 14 * 24 * 3600 * 1000;

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function snoozed(name: string): boolean {
  const at = Number(read(NUDGE_KEY + name) || 0);
  return Date.now() - at < SNOOZE_MS;
}

export function snooze(name: string) {
  write(NUDGE_KEY + name, String(Date.now()));
}

/** Counts this as a visit once per browser session; returns the total. */
export function countVisit(): number {
  try {
    if (sessionStorage.getItem("vchat.visitCounted")) return Number(read("vchat.visits") || 1);
    sessionStorage.setItem("vchat.visitCounted", "1");
  } catch {
    return 1;
  }
  const n = Number(read("vchat.visits") || 0) + 1;
  write("vchat.visits", String(n));
  return n;
}

/** Something good happened (a friend, a few messages): the moment to suggest installing. */
export function markEngaged() {
  write("vchat.engaged", "1");
  window.dispatchEvent(new Event("vchat-engaged"));
}

export function isEngaged(): boolean {
  return read("vchat.engaged") === "1";
}
