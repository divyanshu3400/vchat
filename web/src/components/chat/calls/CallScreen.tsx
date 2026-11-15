"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Icon } from "../bits";
import { useCalls } from "./CallProvider";

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

function StreamVideo({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function StreamAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

/** Full-screen call UI: incoming ring, calling, connecting, in call, ended. */
export default function CallScreen() {
  const { call, localStream, remoteStream, muted, cameraOff, accept, decline, hangUp, toggleMute, toggleCamera } = useCalls();
  if (!call) return null;

  const video = call.kind === "video";
  const inCall = call.phase === "active" || call.phase === "connecting";
  const status =
    call.phase === "incoming"
      ? call.stranger
        ? "The stranger wants a voice call"
        : `Incoming ${video ? "video" : "voice"} call`
      : call.phase === "outgoing"
        ? call.stranger
          ? "Asking the stranger…"
          : "Calling…"
        : call.phase === "connecting"
          ? "Connecting…"
          : call.phase === "ended"
            ? call.note
            : null;

  return (
    <div className={`call-screen${video && inCall ? " is-video" : ""}`} role="dialog" aria-modal="true" aria-label={`Call with ${call.peer.nickname}`}>
      {video && inCall && (
        <>
          <StreamVideo stream={remoteStream} className="call-remote" />
          {localStream && !cameraOff && <StreamVideo stream={localStream} muted className="call-local" />}
        </>
      )}
      {!video && <StreamAudio stream={remoteStream} />}

      <div className="call-top">
        {(!video || !inCall || !remoteStream) && <Avatar name={call.peer.nickname} size={104} />}
        <h2>{call.stranger ? "Stranger" : call.peer.nickname}</h2>
        <p className="call-status">
          {call.phase === "active" && call.startedAt ? <Timer since={call.startedAt} /> : status}
        </p>
        {call.stranger && call.phase !== "ended" && <p className="call-hint">Voice only. Your number and video stay private.</p>}
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
              <button type="button" className={`call-btn soft${muted ? " on" : ""}`} onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"}>
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
