"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../bits";

const MAX_SECONDS = 120;

function pickType(): string {
  // Chrome/Firefox record WebM/Opus; Safari records MP4/AAC.
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

/** Hold-free voice notes: tap mic to start, then Send or Cancel. Stops itself at 2 minutes. */
export default function VoiceRecorder({ onDone, onCancel }: { onDone: (blob: Blob) => void; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const sendOnStop = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const getMic = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({ audio: true })
      : Promise.reject(new Error("unsupported"));
    getMic
      .then((s) => {
        stream = s;
        const type = pickType();
        const rec = new MediaRecorder(s, type ? { mimeType: type } : undefined);
        recorder.current = rec;
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        rec.onstop = () => {
          stream?.getTracks().forEach((t) => t.stop());
          if (sendOnStop.current) onDone(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
        };
        rec.start();
        timer = setInterval(() => {
          setSeconds((n) => {
            if (n + 1 >= MAX_SECONDS) {
              sendOnStop.current = true;
              rec.stop();
            }
            return n + 1;
          });
        }, 1000);
      })
      .catch((e) =>
        setError(
          e instanceof Error && e.message === "unsupported"
            ? "This browser can't record audio."
            : "Allow the microphone to record a voice note.",
        ),
      );
    return () => {
      clearInterval(timer);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onDone]);

  function finish(send: boolean) {
    sendOnStop.current = send;
    if (recorder.current?.state === "recording") recorder.current.stop();
    if (!send) onCancel();
  }

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="recorder" role="group" aria-label="Recording a voice note">
      <button type="button" className="icon-btn" onClick={() => finish(false)} aria-label="Cancel voice note">
        <Icon name="close" />
      </button>
      {error ? (
        <span className="recorder-error">{error}</span>
      ) : (
        <>
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-time">
            {mm}:{ss}
          </span>
          <span className="rec-hint">Recording… max 2:00</span>
        </>
      )}
      <button type="button" className="send-btn" onClick={() => finish(true)} disabled={!!error || seconds < 1} aria-label="Send voice note">
        <Icon name="send" />
      </button>
    </div>
  );
}
