"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ADS_ON } from "@/lib/ads";
import { usePlus } from "@/lib/plus";
import type { Attachment, StrangerPartner } from "@/lib/api";
import { useChat } from "../ChatProvider";

/**
 * Random 1-on-1 chat state. Lives in the app shell, so a chat survives moving between screens;
 * the conversation itself runs on the personal socket (see apps/stranger/consumer.py).
 */
export type Phase = "idle" | "searching" | "chatting" | "ended";
export type EndedBy = "you" | "stranger" | "connection";
export type Line = { id: number; mine: boolean; content: string; at: string; attachment: Attachment | null };

// Ad rules (blueprint): a full-screen ad on every 5th skip, at most once every 4 minutes,
// only between strangers and never during a conversation.
const SKIPS_PER_INTERSTITIAL = 5;
const INTERSTITIAL_GAP_MS = 4 * 60 * 1000;
const TYPING_SHOW_MS = 3500;
const TYPING_SEND_GAP_MS = 2000;

type StrangerValue = {
  phase: Phase;
  partner: StrangerPartner | null;
  session: string | null;
  lines: Line[];
  partnerTyping: boolean;
  waiting: number;
  endedBy: EndedBy | null;
  region: string;
  /** "any", or "F" / "M" (Plus or a rewarded-ad unlock; the server checks). */
  want: string;
  setWant: (want: string) => void;
  notice: string;
  interstitial: boolean;
  setRegion: (region: string) => void;
  setNotice: (text: string) => void;
  start: () => void;
  next: () => void;
  cancel: () => void;
  leave: () => void;
  send: (text: string, attachmentId?: string) => boolean;
  typing: () => void;
  finishInterstitial: () => void;
};

const StrangerContext = createContext<StrangerValue | null>(null);

export function useStranger() {
  const ctx = useContext(StrangerContext);
  if (!ctx) throw new Error("useStranger must be used inside <StrangerProvider>");
  return ctx;
}

export default function StrangerProvider({ children }: { children: React.ReactNode }) {
  const { me, sendRaw, subscribe } = useChat();
  const [phase, setPhase] = useState<Phase>("idle");
  const [partner, setPartner] = useState<StrangerPartner | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const [endedBy, setEndedBy] = useState<EndedBy | null>(null);
  const [region, setRegion] = useState("any");
  const [want, setWant] = useState("any");
  const [notice, setNotice] = useState("");
  const [interstitial, setInterstitial] = useState(false);

  const plus = usePlus();
  const meRef = useRef(me);
  const plusRef = useRef(plus);
  const phaseRef = useRef(phase);
  const skips = useRef(0);
  const lastInterstitial = useRef(-Infinity);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    meRef.current = me;
    plusRef.current = plus;
  }, [me, plus]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(
    () =>
      subscribe((event) => {
        switch (event.type) {
          case "stranger.waiting":
            setPhase("searching");
            setWaiting(event.waiting);
            break;
          case "stranger.matched":
            setPartner(event.partner);
            setSession(event.session);
            setLines([]);
            setEndedBy(null);
            setPartnerTyping(false);
            setNotice("");
            setPhase("chatting");
            break;
          case "stranger.message": {
            const m = event.message;
            setPartnerTyping(false);
            setLines((l) =>
              l.some((x) => x.id === m.id)
                ? l
                : [
                    ...l,
                    {
                      id: m.id,
                      mine: m.sender_id === meRef.current?.id,
                      content: m.content,
                      at: m.created_at,
                      attachment: m.attachment,
                    },
                  ],
            );
            break;
          }
          case "stranger.typing":
            setPartnerTyping(true);
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setPartnerTyping(false), TYPING_SHOW_MS);
            break;
          case "stranger.ended":
            setPartnerTyping(false);
            if (event.by === "stranger") {
              setEndedBy("stranger");
              setPhase("ended");
            } else if (event.by === "you") {
              setEndedBy("you");
              // A new search usually follows straight away ("Next"); "waiting" or "matched" will arrive.
            }
            break;
          case "stranger.idle":
            // After "Leave" we keep the ended chat on screen (Add friend, Report still work).
            if (phaseRef.current === "ended") break;
            setPhase("idle");
            setPartner(null);
            setSession(null);
            break;
          case "ready":
            // The personal socket reconnected: the server ended whatever the old socket had going.
            if (phaseRef.current === "chatting" || phaseRef.current === "searching") {
              setEndedBy("connection");
              setPhase(phaseRef.current === "chatting" ? "ended" : "idle");
            }
            break;
          case "error":
            if (["rate_limited", "no_chat", "locked_photos", "invalid_attachment"].includes(event.code)) setNotice(event.detail);
            if (event.code === "locked_filter") {
              // The unlock ran out (or never existed): fall back to "Anyone" and say why.
              setWant("any");
              setPhase("idle");
              setNotice("Your women/men-only unlock has run out. Unlock it again or match with anyone.");
            }
            break;
        }
      }),
    [subscribe],
  );

  const find = useCallback(() => {
    if (!sendRaw({ type: "stranger.find", region, want })) {
      setNotice("You're offline. Reconnecting…");
      return;
    }
    setNotice("");
    setPhase("searching");
  }, [region, want, sendRaw]);

  const start = useCallback(() => find(), [find]);

  const next = useCallback(() => {
    skips.current += 1;
    const due = skips.current % SKIPS_PER_INTERSTITIAL === 0;
    if (ADS_ON && !plusRef.current && due && Date.now() - lastInterstitial.current > INTERSTITIAL_GAP_MS) {
      lastInterstitial.current = Date.now();
      // End the current chat now; the next search starts when the ad is closed.
      if (phaseRef.current === "chatting") sendRaw({ type: "stranger.leave" });
      setInterstitial(true);
      return;
    }
    find();
  }, [find, sendRaw]);

  const finishInterstitial = useCallback(() => {
    setInterstitial(false);
    find();
  }, [find]);

  const cancel = useCallback(() => {
    sendRaw({ type: "stranger.cancel" });
    setPhase("idle");
  }, [sendRaw]);

  const leave = useCallback(() => {
    sendRaw({ type: "stranger.leave" });
    setEndedBy("you");
    setPhase("ended");
  }, [sendRaw]);

  const send = useCallback(
    (text: string, attachmentId?: string) =>
      sendRaw({ type: "stranger.message", content: text, attachment: attachmentId, client_id: crypto.randomUUID() }),
    [sendRaw],
  );

  const typing = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_GAP_MS) return;
    lastTypingSent.current = now;
    sendRaw({ type: "stranger.typing" });
  }, [sendRaw]);

  const value = useMemo<StrangerValue>(
    () => ({
      phase,
      partner,
      session,
      lines,
      partnerTyping,
      waiting,
      endedBy,
      region,
      want,
      setWant,
      notice,
      interstitial,
      setRegion,
      setNotice,
      start,
      next,
      cancel,
      leave,
      send,
      typing,
      finishInterstitial,
    }),
    [phase, partner, session, lines, partnerTyping, waiting, endedBy, region, want, notice, interstitial, start, next, cancel, leave, send, typing, finishInterstitial],
  );

  return <StrangerContext.Provider value={value}>{children}</StrangerContext.Provider>;
}
