"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_VOICE_SECONDS = 120;
const LEVELS_KEPT = 32;

function pickType(): string {
  // Chrome/Firefox record WebM/Opus; Safari records MP4/AAC.
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

export function voiceFilename(blob: Blob) {
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  return `voice.${ext}`;
}

/**
 * Microphone recording for voice messages: start(), then finish(true) to send or finish(false)
 * to throw it away. `levels` is a rolling list of loudness values (0–1) for a live waveform.
 * Stops and sends by itself at 2 minutes.
 */
export function useRecorder(onDone: (blob: Blob) => void) {
  const [active, setActive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const sendOnStop = useRef(false);
  const cancelled = useRef(false);
  const startedAt = useRef(0);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; meter?: ReturnType<typeof setInterval>; ctx?: AudioContext }>({});
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const release = useCallback(() => {
    clearInterval(timers.current.tick);
    clearInterval(timers.current.meter);
    timers.current.ctx?.close().catch(() => undefined);
    timers.current = {};
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const finish = useCallback(
    (send: boolean) => {
      cancelled.current = !send;
      sendOnStop.current = send && Date.now() - startedAt.current >= 800;
      const rec = recorder.current;
      if (rec && rec.state === "recording") rec.stop();
      else release();
      setActive(false);
    },
    [release],
  );

  const start = useCallback(async () => {
    setError("");
    setSeconds(0);
    setLevels([]);
    setActive(true);
    cancelled.current = false;
    sendOnStop.current = false;
    chunks.current = [];
    let s: MediaStream;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("unsupported");
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setError(
        e instanceof Error && e.message === "unsupported"
          ? "This browser can't record audio."
          : "Allow the microphone to send voice messages.",
      );
      return;
    }
    if (cancelled.current) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream.current = s;
    const type = pickType();
    const rec = new MediaRecorder(s, type ? { mimeType: type } : undefined);
    recorder.current = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      release();
      if (sendOnStop.current && chunks.current.length) {
        onDoneRef.current(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
      }
    };
    rec.start(250);
    startedAt.current = Date.now();

    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timers.current.ctx = ctx;
      timers.current.meter = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const level = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        setLevels((l) => [...l.slice(-(LEVELS_KEPT - 1)), level]);
      }, 90);
    } catch {
      /* no live waveform; recording still works */
    }

    timers.current.tick = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(secs);
      if (secs >= MAX_VOICE_SECONDS) {
        sendOnStop.current = true;
        if (rec.state === "recording") rec.stop();
        setActive(false);
      }
    }, 250);
  }, [release]);

  useEffect(
    () => () => {
      cancelled.current = true;
      sendOnStop.current = false;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
    },
    [release],
  );

  return { active, seconds, levels, error, start, finish, clearError: () => setError("") };
}
