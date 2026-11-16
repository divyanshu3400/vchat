"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar, Icon } from "../bits";
import { useCalls } from "./CallProvider";
import { useMicGlow, VoiceRing } from "./VoiceRing";

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="call-timer">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

function StreamVideo({
  stream,
  muted,
  className,
  videoRef,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  className: string;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream, ref]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function StreamAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

type Corner = "tl" | "tr" | "bl" | "br";

/**
 * A call in one of three shapes:
 * - full screen (ringing, or while you look at it),
 * - minimised: a green bar on top of the app ("tap to return") so you can keep chatting; a video
 *   call also floats as a small window you can drag to any corner,
 * - the browser's own picture-in-picture ("Pop out") for video, visible outside vChat too.
 * The audio element stays mounted in every shape, so minimising never cuts the sound.
 */
export default function CallScreen() {
  const { call, localStream, remoteStream, muted, cameraOff, accept, decline, hangUp, toggleMute, toggleCamera } = useCalls();
  const pathname = usePathname();
  // Minimised for this call (a new call always opens full screen).
  const [miniFor, setMiniFor] = useState<string | null>(null);
  const [corner, setCorner] = useState<Corner>("br");
  const [lastPath, setLastPath] = useState(pathname);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);

  const live = !!call && (call.phase === "active" || call.phase === "connecting" || call.phase === "outgoing");
  // Going to another chat or page during a call: the call steps aside instead of covering it.
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (call && live) setMiniFor(call.id);
  }
  const mini = !!call && live && miniFor === call.id;

  // The bar takes room at the top of the app (see html.in-call-bar in chat.css).
  useEffect(() => {
    document.documentElement.classList.toggle("in-call-bar", mini);
    return () => document.documentElement.classList.remove("in-call-bar");
  }, [mini]);

  // Closing or reloading the tab during a call asks first (it would end the call).
  useEffect(() => {
    if (!live) return;
    const ask = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [live]);

  // Phones show the call on the lock screen and in notifications, with hang up / mute.
  const peerName = call ? (call.stranger ? "Anonymous" : call.peer.nickname) : "";
  const active = call?.phase === "active";
  // Your own voice lights the mute button (voice calls, full screen, not muted).
  const micBtn = useRef<HTMLButtonElement>(null);
  useMicGlow(localStream, !!call && call.kind !== "video" && active && !muted && !mini, micBtn);
  useEffect(() => {
    const ms = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
    if (!ms || !active) return;
    try {
      ms.metadata = new MediaMetadata({ title: `vChat call · ${peerName}`, artist: "vChat", artwork: [{ src: "/app-icon/192", sizes: "192x192", type: "image/png" }] });
      ms.setActionHandler("hangup" as MediaSessionAction, () => hangUp());
      ms.setActionHandler("togglemicrophone" as MediaSessionAction, () => toggleMute());
    } catch {
      /* older browsers: no call controls outside the page */
    }
    return () => {
      try {
        ms.metadata = null;
        ms.setActionHandler("hangup" as MediaSessionAction, null);
        ms.setActionHandler("togglemicrophone" as MediaSessionAction, null);
      } catch {
        /* nothing to undo */
      }
    };
  }, [active, peerName, hangUp, toggleMute]);

  if (!call) return null;

  const video = call.kind === "video";
  const inCall = call.phase === "active" || call.phase === "connecting";
  const canPopOut = video && inCall && typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled;
  const status =
    call.phase === "incoming"
      ? call.stranger
        ? "Anonymous wants a voice call"
        : `Incoming ${video ? "video" : "voice"} call`
      : call.phase === "outgoing"
        ? call.stranger
          ? "Asking them…"
          : "Calling…"
        : call.phase === "connecting"
          ? "Connecting…"
          : call.phase === "ended"
            ? call.note
            : null;

  async function popOut() {
    try {
      await remoteRef.current?.requestPictureInPicture();
      setMiniFor(call?.id ?? null);
    } catch {
      /* not allowed here: the in-app window still works */
    }
  }

  // --- minimised -------------------------------------------------------------------------
  if (mini) {
    const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, moved: false };
    };
    const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      d.dx = e.clientX - d.x;
      d.dy = e.clientY - d.y;
      if (Math.abs(d.dx) + Math.abs(d.dy) > 6) d.moved = true;
      if (pipRef.current) pipRef.current.style.transform = `translate(${d.dx}px, ${d.dy}px)`;
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      const el = pipRef.current;
      if (!d || !el) return;
      if (!d.moved) {
        el.style.transform = "";
        setMiniFor(null); // a tap opens the call again
        return;
      }
      // Snap to the nearest corner.
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      el.style.transform = "";
      setCorner(`${cy < window.innerHeight / 2 ? "t" : "b"}${cx < window.innerWidth / 2 ? "l" : "r"}` as Corner);
    };

    return (
      <>
        {!video && <StreamAudio stream={remoteStream} />}
        <div className="call-bar" role="status">
          <button type="button" className="call-bar-main" onClick={() => setMiniFor(null)} aria-label="Return to the call">
            <span className="call-bar-dot" aria-hidden="true" />
            <Icon name={video ? "video" : "phone"} size={16} />
            <b>{peerName}</b>
            <span className="call-bar-time">{call.phase === "active" && call.startedAt ? <Timer since={call.startedAt} /> : status}</span>
            <small>Tap to return</small>
          </button>
          <button type="button" className={`call-bar-btn${muted ? " on" : ""}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>
            <Icon name={muted ? "micoff" : "mic"} size={17} />
          </button>
          <button type="button" className="call-bar-btn end" onClick={hangUp} aria-label="End call">
            <Icon name="hangup" size={17} />
          </button>
        </div>
        {video && (
          <div
            ref={pipRef}
            className={`call-pip at-${corner}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            role="button"
            aria-label="Video call. Tap to open, drag to move."
          >
            {remoteStream ? (
              <StreamVideo stream={remoteStream} className="call-pip-video" videoRef={remoteRef} />
            ) : (
              <span className="call-pip-wait">
                <Avatar name={peerName} size={46} />
              </span>
            )}
            {localStream && !cameraOff && <StreamVideo stream={localStream} muted className="call-pip-self" />}
            {canPopOut && (
              <button
                type="button"
                className="call-pip-out"
                aria-label="Pop out"
                title="Pop out (keeps showing outside vChat)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={popOut}
              >
                <Icon name="expand" size={14} />
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  // --- full screen -------------------------------------------------------------------------
  return (
    <div className={`call-screen${video && inCall ? " is-video" : ""}`} role="dialog" aria-modal="true" aria-label={`Call with ${peerName}`}>
      {video && inCall && (
        <>
          <StreamVideo stream={remoteStream} className="call-remote" videoRef={remoteRef} />
          {localStream && !cameraOff && <StreamVideo stream={localStream} muted className="call-local" />}
        </>
      )}
      {!video && <StreamAudio stream={remoteStream} />}

      {live && (
        <div className="call-corner">
          <button type="button" className="call-min" onClick={() => setMiniFor(call.id)} aria-label="Minimise call" title="Minimise: keep chatting during the call">
            <Icon name="min" size={20} />
          </button>
          {canPopOut && (
            <button type="button" className="call-min" onClick={popOut} aria-label="Pop out" title="Pop out (keeps showing outside vChat)">
              <Icon name="expand" size={18} />
            </button>
          )}
        </div>
      )}

      <div className="call-top">
        {!video ? (
          <VoiceRing name={peerName} stream={remoteStream} talking={call.phase === "active" && !mini} />
        ) : (
          (!inCall || !remoteStream) && <Avatar name={peerName} size={104} />
        )}
        <h2>{peerName}</h2>
        <p className="call-status">{call.phase === "active" && call.startedAt ? <Timer since={call.startedAt} /> : status}</p>
        {call.stranger && call.phase !== "ended" && <p className="call-hint">Voice only. Your name, number and video stay private.</p>}
      </div>

      <div className="call-controls">
        {call.phase === "incoming" ? (
          <>
            <button type="button" className="call-btn danger" onClick={decline} aria-label="Decline">
              <Icon name="close" size={28} />
            </button>
            <button type="button" className="call-btn accept" onClick={accept} aria-label="Accept">
              <Icon name={video ? "video" : "phone"} size={28} />
            </button>
          </>
        ) : call.phase === "ended" ? null : (
          <>
            {inCall && (
              <button ref={micBtn} type="button" className={`call-btn soft mic-btn${muted ? " on" : ""}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>
                <Icon name={muted ? "micoff" : "mic"} size={24} />
              </button>
            )}
            {inCall && video && (
              <button type="button" className={`call-btn soft${cameraOff ? " on" : ""}`} onClick={toggleCamera} aria-pressed={cameraOff} aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}>
                <Icon name={cameraOff ? "videooff" : "video"} size={24} />
              </button>
            )}
            <button type="button" className="call-btn danger" onClick={hangUp} aria-label="End call">
              <Icon name="hangup" size={28} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
