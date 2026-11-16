"use client";

import { useSyncExternalStore } from "react";

/**
 * vChat's sounds, all synthesised with Web Audio (nothing to download), with one set of settings
 * kept on this device: master switch, volume, each sound on or off, and vibration.
 *
 * Browsers only let a page make sound after the person has tapped or typed once; the first such
 * gesture unlocks the shared AudioContext (see `unlock`).
 */

export type SoundName = "receive" | "send" | "notify" | "match" | "request" | "ring";

export type SoundSettings = {
  on: boolean;
  volume: number; // 0..100
  vibrate: boolean;
  events: Record<SoundName, boolean>;
};

export const SOUND_LABELS: [SoundName, string, string][] = [
  ["receive", "Message in an open chat", "A soft pop when a message lands in the chat you're in"],
  ["send", "Message sent", "A light whoosh when your message goes"],
  ["notify", "Message in another chat", "A chime with the banner at the top"],
  ["match", "Random chat match", "A ding when you're connected to someone"],
  ["request", "Requests", "Friend requests, message requests and new friends"],
  ["ring", "Incoming call", "The ringtone when a friend calls"],
];

const KEY = "vchat.sounds";
const DEFAULTS: SoundSettings = {
  on: true,
  volume: 70,
  vibrate: true,
  events: { receive: true, send: true, notify: true, match: true, request: true, ring: true },
};

let cached: SoundSettings | null = null;
const listeners = new Set<() => void>();

function read(): SoundSettings {
  if (cached) return cached;
  let saved: Partial<SoundSettings> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    // The old "Alerts inside vChat" switch, when it was turned off, also silenced the chime.
    if (!localStorage.getItem(KEY) && localStorage.getItem("vchat.inAppAlerts") === "off") saved = { events: { ...DEFAULTS.events, notify: false } };
  } catch {
    /* private mode or bad JSON: defaults */
  }
  cached = { ...DEFAULTS, ...saved, events: { ...DEFAULTS.events, ...(saved.events ?? {}) } };
  return cached;
}

export function getSoundSettings(): SoundSettings {
  return typeof window === "undefined" ? DEFAULTS : read();
}

export function setSoundSettings(change: Partial<Omit<SoundSettings, "events">> & { events?: Partial<SoundSettings["events"]> }) {
  const now = read();
  cached = { ...now, ...change, events: { ...now.events, ...(change.events ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    /* private mode: works until reload */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = null;
      fn();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(subscribe, getSoundSettings, () => DEFAULTS);
}

// --- audio ---

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    try {
      ctx = new Ctx();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => undefined);
  return ctx;
}

/** Call once on the client: the first tap or key press lets the page make sound. */
export function unlockSoundsOnGesture() {
  if (typeof window === "undefined") return;
  const go = () => {
    const c = audio();
    if (c && c.state === "running") {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
    }
  };
  window.addEventListener("pointerdown", go, true);
  window.addEventListener("keydown", go, true);
}

type Note = { freq: number; to?: number; at: number; len: number; peak: number; type?: OscillatorType };

/** Each sound is a few short notes; `peak` is relative loudness before the volume setting. */
const PATTERNS: Record<Exclude<SoundName, "ring">, Note[]> = {
  // A bubble pop: a quick upward bend.
  receive: [{ freq: 420, to: 880, at: 0, len: 0.13, peak: 0.9 }],
  // A light whoosh up, quieter than receiving.
  send: [{ freq: 500, to: 1150, at: 0, len: 0.09, peak: 0.45, type: "triangle" }],
  // Two bright notes, like the banner chime but fuller.
  notify: [
    { freq: 880, at: 0, len: 0.16, peak: 0.8 },
    { freq: 1320, at: 0.1, len: 0.26, peak: 0.8 },
  ],
  // Three rising notes: you found someone.
  match: [
    { freq: 1047, at: 0, len: 0.14, peak: 0.75 },
    { freq: 1319, at: 0.11, len: 0.14, peak: 0.75 },
    { freq: 1568, at: 0.22, len: 0.32, peak: 0.85 },
  ],
  // A soft bell, two notes apart.
  request: [
    { freq: 784, at: 0, len: 0.22, peak: 0.75 },
    { freq: 1175, at: 0.14, len: 0.34, peak: 0.75 },
  ],
};

const RING: Note[] = [
  { freq: 880, at: 0, len: 0.24, peak: 0.9 },
  { freq: 660, at: 0.25, len: 0.24, peak: 0.9 },
  { freq: 880, at: 0.6, len: 0.24, peak: 0.9 },
  { freq: 660, at: 0.85, len: 0.24, peak: 0.9 },
];

function playNotes(notes: Note[], volume: number) {
  const c = audio();
  if (!c || c.state !== "running" || volume <= 0) return;
  // Volume is perceived roughly logarithmically: square the slider so low settings stay usable.
  const level = 0.4 * (volume / 100) ** 2;
  const now = c.currentTime + 0.01;
  for (const n of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.setValueAtTime(n.freq, now + n.at);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, now + n.at + n.len * 0.6);
    const peak = Math.max(0.0002, level * n.peak);
    gain.gain.setValueAtTime(0.0001, now + n.at);
    gain.gain.exponentialRampToValueAtTime(peak, now + n.at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.at + n.len);
    osc.connect(gain).connect(c.destination);
    osc.start(now + n.at);
    osc.stop(now + n.at + n.len + 0.02);
  }
}

const VIBRATION: Record<SoundName, number | number[]> = {
  receive: 15,
  send: 0,
  notify: 30,
  match: [40, 60, 40],
  request: [30, 50, 30],
  ring: [300, 150, 300],
};

const lastPlayed: Partial<Record<SoundName, number>> = {};

/**
 * Play one sound if it's on. A burst of the same sound within 150 ms plays once (several
 * messages arriving together shouldn't machine-gun). `force` ignores the switches (settings preview).
 */
export function playSound(name: SoundName, opts: { force?: boolean; vibrate?: boolean } = {}) {
  const s = getSoundSettings();
  if (!opts.force && (!s.on || !s.events[name])) return;
  const t = Date.now();
  if (!opts.force && t - (lastPlayed[name] ?? 0) < 150) return;
  lastPlayed[name] = t;
  playNotes(name === "ring" ? RING : PATTERNS[name], s.volume);
  if (opts.vibrate !== false && s.vibrate && VIBRATION[name]) navigator.vibrate?.(VIBRATION[name]);
}

/** The call ringtone, repeating until the returned stop function is called. */
export function startRingtone(): () => void {
  const s = getSoundSettings();
  if (!s.on || !s.events.ring) return () => undefined;
  const beep = () => playSound("ring");
  beep();
  const t = setInterval(beep, 2200);
  return () => {
    clearInterval(t);
    navigator.vibrate?.(0);
  };
}
