"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "../ChatProvider";
import { useDock } from "../Dock";
import { useStranger } from "../stranger/StrangerProvider";
import { Avatar } from "../bits";

const SHOW_MS = 4500;
const PREF_KEY = "vchat.inAppAlerts";

export function inAppAlertsOn(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setInAppAlerts(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* private mode */
  }
}

/** A soft two-note tick through Web Audio (no file to load); silent if the browser refuses. */
function tick() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.14);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 500);
  } catch {
    /* no sound */
  }
}

type Shown = { id: number; nickname: string; text: string; key: number };

/**
 * A friend's message while you're in another chat (or on any other screen): a banner at the top
 * for a few seconds, a soft sound and a buzz. Tap it to open that chat. Not during a random chat.
 */
export default function MessageBanner() {
  const { me, subscribe, isWatching, conversations } = useChat();
  const mutedRef = useRef(new Set<number>());
  useEffect(() => {
    mutedRef.current = new Set(conversations.filter((c) => c.muted).map((c) => c.user.id));
  }, [conversations]);
  const { openChat } = useDock();
  const { phase } = useStranger();
  const [shown, setShown] = useState<Shown | null>(null);
  const phaseRef = useRef(phase);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== "dm") return;
        const m = event.message;
        if (!me || m.sender.id === me.id || isWatching(m.sender.id) || mutedRef.current.has(m.sender.id)) return;
        if (phaseRef.current === "chatting" || document.visibilityState !== "visible" || !inAppAlertsOn()) return;
        const kind = m.attachment?.kind;
        const text = m.content || (kind === "image" ? "📷 Photo" : kind === "video" ? "🎬 Video" : kind === "audio" ? "🎤 Voice message" : "");
        setShown({ id: m.sender.id, nickname: m.sender.nickname, text, key: m.id });
        tick();
        navigator.vibrate?.(30);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setShown(null), SHOW_MS);
      }),
    [subscribe, me, isWatching],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!shown) return null;
  return (
    <button
      key={shown.key}
      type="button"
      className="msg-banner"
      onClick={() => {
        setShown(null);
        openChat(shown.id);
      }}
      aria-live="polite"
    >
      <Avatar name={shown.nickname} size={36} />
      <span className="msg-banner-text">
        <b>{shown.nickname}</b>
        <span>{shown.text}</span>
      </span>
    </button>
  );
}
