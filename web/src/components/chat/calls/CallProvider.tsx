"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchIceServers, type CallKind, type ChatUser, type UserEvent } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { useStranger } from "../stranger/StrangerProvider";

/**
 * Voice and video calls over WebRTC. The server only relays the setup ("signaling") between
 * the two sockets; audio and video go browser to browser, or through our TURN relay when a
 * direct path is blocked. One call at a time.
 */
export type CallPhase = "outgoing" | "incoming" | "connecting" | "active" | "ended";
export type Call = {
  id: string;
  peer: Pick<ChatUser, "id" | "nickname">;
  kind: CallKind;
  stranger: boolean;
  direction: "out" | "in";
  phase: CallPhase;
  startedAt: number | null;
  note: string; // why it ended, or a problem to show
};

type CallValue = {
  call: Call | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  start: (peer: Pick<ChatUser, "id" | "nickname">, kind: CallKind, stranger?: boolean) => Promise<void>;
  accept: () => Promise<void>;
  decline: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
};

const CallContext = createContext<CallValue | null>(null);

export function useCalls() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCalls must be used inside <CallProvider>");
  return ctx;
}

const RING_TIMEOUT_MS = 40_000;
const ENDED_LINGER_MS = 1800;

const REASONS: Record<string, string> = {
  declined: "Call declined",
  no_answer: "No answer",
  disconnected: "Connection lost",
  failed: "Couldn't connect the call",
  cancelled: "Missed call",
  ended: "Call ended",
  busy: "They're on another call",
};

function mediaError(e: unknown, kind: CallKind) {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError") return `Allow the ${kind === "video" ? "camera and microphone" : "microphone"} to make calls.`;
  if (name === "NotFoundError") return `No ${kind === "video" ? "camera or microphone" : "microphone"} found.`;
  return "Couldn't start the call on this device.";
}

/** A short two-tone ring through Web Audio (no file to load); silent if the browser refuses. */
function startRing(): () => void {
  try {
    const ctx = new AudioContext();
    let stopped = false;
    const beep = () => {
      if (stopped) return;
      for (const [freq, at] of [[880, 0], [660, 0.25]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + at);
        osc.stop(ctx.currentTime + at + 0.24);
      }
      navigator.vibrate?.([300, 150, 300]);
    };
    beep();
    const t = setInterval(beep, 2200);
    return () => {
      stopped = true;
      clearInterval(t);
      navigator.vibrate?.(0);
      ctx.close().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}

export default function CallProvider({ children }: { children: React.ReactNode }) {
  const { getAccess, sendRaw, subscribe } = useChat();
  const { phase: strangerPhase } = useStranger();
  const [call, setCall] = useState<Call | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);

  const callRef = useRef<Call | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopRing = useRef<() => void>(() => undefined);

  const update = useCallback((patch: Partial<Call> | null) => {
    setCall((c) => {
      const next = patch === null ? null : c ? { ...c, ...patch } : null;
      callRef.current = next;
      return next;
    });
  }, []);

  const teardown = useCallback(() => {
    clearTimeout(ringTimer.current);
    stopRing.current();
    pc.current?.close();
    pc.current = null;
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    pendingCandidates.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCameraOff(false);
  }, []);

  const finish = useCallback(
    (reason: string) => {
      teardown();
      update({ phase: "ended", note: REASONS[reason] ?? REASONS.ended });
      setTimeout(() => {
        if (callRef.current?.phase === "ended") update(null);
      }, ENDED_LINGER_MS);
    },
    [teardown, update],
  );

  const getMedia = useCallback(async (kind: CallKind) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: kind === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    local.current = stream;
    setLocalStream(stream);
    return stream;
  }, []);

  const makePeer = useCallback(
    async (callId: string, stream: MediaStream) => {
      const { ice_servers } = await fetchIceServers(await getAccess());
      const peer = new RTCPeerConnection({ iceServers: ice_servers });
      pc.current = peer;
      stream.getTracks().forEach((t) => peer.addTrack(t, stream));
      peer.onicecandidate = (e) => {
        if (e.candidate) sendRaw({ type: "call.signal", call_id: callId, data: { candidate: e.candidate.toJSON() } });
      };
      peer.ontrack = (e) => setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected" && callRef.current?.phase !== "active") {
          update({ phase: "active", startedAt: Date.now() });
        } else if (peer.connectionState === "failed") {
          sendRaw({ type: "call.end", call_id: callId, reason: "failed" });
          finish("failed");
        }
      };
      return peer;
    },
    [getAccess, sendRaw, update, finish],
  );

  const flushCandidates = useCallback(async () => {
    const peer = pc.current;
    if (!peer) return;
    for (const c of pendingCandidates.current.splice(0)) await peer.addIceCandidate(c).catch(() => undefined);
  }, []);

  // --- outgoing --------------------------------------------------------------------

  const start = useCallback<CallValue["start"]>(
    async (peer, kind, stranger = false) => {
      if (callRef.current && callRef.current.phase !== "ended") return;
      const id = crypto.randomUUID();
      const base: Call = { id, peer, kind, stranger, direction: "out", phase: "outgoing", startedAt: null, note: "" };
      callRef.current = base;
      setCall(base);
      try {
        await getMedia(kind);
      } catch (e) {
        teardown();
        update({ phase: "ended", note: mediaError(e, kind) });
        setTimeout(() => update(null), 3000);
        return;
      }
      const msg: Record<string, unknown> = { type: "call.invite", call_id: id, kind };
      if (stranger) msg.stranger = true;
      else msg.to = peer.id;
      if (!sendRaw(msg)) return finish("disconnected");
      ringTimer.current = setTimeout(() => {
        if (callRef.current?.id === id && callRef.current.phase === "outgoing") {
          sendRaw({ type: "call.end", call_id: id, reason: "cancelled" });
          finish("no_answer");
        }
      }, RING_TIMEOUT_MS);
    },
    [getMedia, sendRaw, teardown, update, finish],
  );

  // --- incoming --------------------------------------------------------------------

  const accept = useCallback(async () => {
    const c = callRef.current;
    if (!c || c.phase !== "incoming") return;
    stopRing.current();
    update({ phase: "connecting" });
    try {
      const stream = await getMedia(c.kind);
      await makePeer(c.id, stream); // ready before the caller's offer can arrive
    } catch (e) {
      sendRaw({ type: "call.decline", call_id: c.id });
      teardown();
      update({ phase: "ended", note: mediaError(e, c.kind) });
      setTimeout(() => update(null), 3000);
      return;
    }
    sendRaw({ type: "call.accept", call_id: c.id });
  }, [getMedia, makePeer, sendRaw, teardown, update]);

  const decline = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    sendRaw({ type: "call.decline", call_id: c.id });
    teardown();
    update(null);
  }, [sendRaw, teardown, update]);

  const hangUp = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    sendRaw({ type: "call.end", call_id: c.id, reason: c.phase === "outgoing" ? "cancelled" : "ended" });
    finish("ended");
  }, [sendRaw, finish]);

  // --- signaling events ---------------------------------------------------------------

  useEffect(
    () =>
      subscribe(async (event: UserEvent) => {
        const c = callRef.current;
        switch (event.type) {
          case "call.incoming": {
            if (c && c.phase !== "ended") {
              // Already in a call: say no for this device; another tab may still answer.
              return;
            }
            const next: Call = {
              id: event.call_id,
              peer: { id: event.from.id, nickname: event.from.nickname },
              kind: event.kind,
              stranger: event.stranger,
              direction: "in",
              phase: "incoming",
              startedAt: null,
              note: "",
            };
            callRef.current = next;
            setCall(next);
            stopRing.current = startRing();
            return;
          }
          case "call.accepted": {
            if (!c || c.id !== event.call_id || !local.current) return;
            clearTimeout(ringTimer.current);
            update({ phase: "connecting" });
            const peer = await makePeer(c.id, local.current);
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            sendRaw({ type: "call.signal", call_id: c.id, data: { sdp: peer.localDescription?.toJSON() } });
            return;
          }
          case "call.signal": {
            const peer = pc.current;
            if (!c || c.id !== event.call_id || !peer) return;
            const { sdp, candidate } = event.data;
            if (sdp) {
              await peer.setRemoteDescription(sdp);
              await flushCandidates();
              if (sdp.type === "offer") {
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                sendRaw({ type: "call.signal", call_id: c.id, data: { sdp: peer.localDescription?.toJSON() } });
              }
            } else if (candidate) {
              if (peer.remoteDescription) await peer.addIceCandidate(candidate).catch(() => undefined);
              else pendingCandidates.current.push(candidate);
            }
            return;
          }
          case "call.taken":
            // Answered on another tab or device.
            if (c && c.id === event.call_id && c.phase === "incoming") {
              teardown();
              update(null);
            }
            return;
          case "call.declined":
            if (c && c.id === event.call_id) finish("declined");
            return;
          case "call.ended":
            if (c && c.id === event.call_id && c.phase !== "ended") finish(c.phase === "incoming" ? "cancelled" : event.reason);
            return;
          case "error":
            if (c && c.phase === "outgoing" && ["busy", "call_not_allowed", "no_chat"].includes(event.code)) {
              teardown();
              update({ phase: "ended", note: event.detail });
              setTimeout(() => update(null), 3000);
            }
            return;
          case "ready":
            // The personal socket reconnected: the server ended this socket's calls.
            if (c && c.phase !== "ended") finish("disconnected");
            return;
        }
      }),
    [subscribe, makePeer, flushCandidates, sendRaw, teardown, update, finish],
  );

  // A stranger call can't outlive the random chat it belongs to.
  useEffect(() => {
    const c = callRef.current;
    if (c?.stranger && c.phase !== "ended" && strangerPhase !== "chatting") {
      const t = setTimeout(() => {
        sendRaw({ type: "call.end", call_id: c.id, reason: "ended" });
        finish("ended");
      }, 0);
      return () => clearTimeout(t);
    }
  }, [strangerPhase, sendRaw, finish]);

  const toggleMute = useCallback(() => {
    const tracks = local.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(() => {
    const tracks = local.current?.getVideoTracks() ?? [];
    const next = !cameraOff;
    tracks.forEach((t) => (t.enabled = !next));
    setCameraOff(next);
  }, [cameraOff]);

  // Leaving the page mid-call: tell the other side right away.
  useEffect(() => {
    const bye = () => {
      const c = callRef.current;
      if (c && c.phase !== "ended") sendRaw({ type: "call.end", call_id: c.id, reason: "disconnected" });
    };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [sendRaw]);

  const value = useMemo<CallValue>(
    () => ({ call, localStream, remoteStream, muted, cameraOff, start, accept, decline, hangUp, toggleMute, toggleCamera }),
    [call, localStream, remoteStream, muted, cameraOff, start, accept, decline, hangUp, toggleMute, toggleCamera],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}
