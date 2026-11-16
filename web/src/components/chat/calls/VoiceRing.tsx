"use client";

import { useEffect, useRef } from "react";
import { Avatar } from "../bits";

type Meter = { level: number; bins: Uint8Array };

/**
 * Listens to a stream's sound and calls `onFrame` about 60 times a second with a smoothed
 * loudness (0..1) and the frequency bins. Nothing re-renders: callers draw straight to a canvas or
 * set a CSS variable. Stops when the tab is hidden, the stream goes, or `enabled` turns false.
 */
function useVoiceMeter(stream: MediaStream | null, enabled: boolean, onFrame: (m: Meter, t: number) => void) {
  const frame = useRef(onFrame);
  useEffect(() => {
    frame.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!stream || !enabled || !stream.getAudioTracks().length) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      ctx = new Ctx();
      source = ctx.createMediaStreamSource(stream);
    } catch {
      return;
    }
    ctx.resume().catch(() => undefined);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser); // not to the speakers: the <audio> element already plays it
    const wave = new Uint8Array(analyser.fftSize);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let level = 0;
    let raf = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (document.visibilityState !== "visible") return;
      analyser.getByteTimeDomainData(wave);
      analyser.getByteFrequencyData(bins);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) {
        const v = (wave[i] - 128) / 128;
        sum += v * v;
      }
      // Speech RMS sits around 0.02..0.25: stretch it to 0..1, rise fast, fall slowly.
      const target = Math.min(1, Math.sqrt(sum / wave.length) * 5);
      level += (target - level) * (target > level ? 0.45 : 0.08);
      frame.current({ level, bins }, t);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close().catch(() => undefined);
    };
  }, [stream, enabled]);
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The avatar on the voice-call screen, inside a glowing ring. While the call rings or connects the
 * ring turns slowly; once you're talking, soft waves around it rise and fall with the other
 * person's voice (louder voice, bigger waves).
 */
export function VoiceRing({ id, name, stream, talking, size = 104 }: { id?: number; name: string; stream: MediaStream | null; talking: boolean; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = size + 150; // room for the waves around the avatar

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = box * dpr;
    c.height = box * dpr;
    c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, [box]);

  useVoiceMeter(stream, talking && !reducedMotion(), ({ level, bins }, t) => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const mid = box / 2;
    const base = size / 2 + 8;
    g.clearRect(0, 0, box, box);
    const points = 72;
    // Three layers, outer ones fainter and slower: a wave, not a single bouncing circle.
    for (let layer = 2; layer >= 0; layer--) {
      const reach = (18 + layer * 16) * level;
      g.beginPath();
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        // Mirror the low/mid frequency bins around the circle so the shape follows the voice.
        const k = i <= points / 2 ? i : points - i;
        const bin = bins[2 + Math.floor((k / (points / 2)) * 40)] / 255;
        const ripple = Math.sin(a * 5 + t / (420 + layer * 160) + layer) * 0.25 + 0.75;
        const r = base + 2 + reach * (0.45 + bin * 0.55) * ripple;
        const x = mid + Math.cos(a - Math.PI / 2) * r;
        const y = mid + Math.sin(a - Math.PI / 2) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillStyle = `rgba(61, 213, 152, ${0.1 + (2 - layer) * 0.07 + level * 0.12})`;
      g.fill();
    }
  });

  return (
    <span className={`voice-ring${talking ? " talking" : " waiting"}`} style={{ width: size + 20, height: size + 20 }}>
      <canvas ref={canvas} className="voice-wave" style={{ width: box, height: box }} aria-hidden="true" />
      <span className="voice-ring-band" aria-hidden="true" />
      <Avatar id={id} name={name} size={size} />
    </span>
  );
}

/** Lights the mute button softly while your own microphone picks up sound (`--mic` 0..1). */
export function useMicGlow(stream: MediaStream | null, on: boolean, target: React.RefObject<HTMLElement | null>) {
  useVoiceMeter(stream, on, ({ level }) => {
    target.current?.style.setProperty("--mic", level.toFixed(3));
  });
  useEffect(() => {
    if (!on) target.current?.style.setProperty("--mic", "0");
  }, [on, target]);
}
