"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../bits";

const BARS = 36;
const SPEEDS = [1, 1.5, 2];

function fmt(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Bar heights (0–1) from the recording itself; a flat line when the browser can't decode it. */
async function peaksOf(url: string, signal: AbortSignal): Promise<{ peaks: number[]; duration: number }> {
  const buf = await (await fetch(url, { signal })).arrayBuffer();
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks: number[] = [];
    for (let i = 0; i < BARS; i++) {
      let sum = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 16) sum += Math.abs(data[j]);
      peaks.push(sum / (step / 16));
    }
    const max = Math.max(...peaks, 0.01);
    return { peaks: peaks.map((p) => Math.max(0.12, p / max)), duration: audio.duration };
  } finally {
    ctx.close().catch(() => undefined);
  }
}

const FLAT = Array.from({ length: BARS }, (_, i) => 0.25 + 0.2 * Math.abs(Math.sin(i * 1.7)));

export default function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[]>(FLAT);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    peaksOf(src, ctl.signal)
      .then((r) => {
        setPeaks(r.peaks);
        setDuration(r.duration);
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [src]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a) setTime(a.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      // Only one voice message plays at a time.
      document.querySelectorAll<HTMLAudioElement>("audio.vp-audio").forEach((o) => o !== a && o.pause());
      a.play().catch(() => undefined);
    } else {
      a.pause();
    }
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    const total = duration || a?.duration || 0;
    if (!a || !total || !Number.isFinite(total)) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.min(total, Math.max(0, ((e.clientX - r.left) / r.width) * total));
    setTime(a.currentTime);
  }

  function cycleSpeed() {
    const next = (speed + 1) % SPEEDS.length;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  const total = duration || 0;
  const progress = total ? Math.min(1, time / total) : 0;

  return (
    <div className={`vp${playing ? " playing" : ""}`}>
      <audio
        ref={audioRef}
        className="vp-audio"
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && !duration) setDuration(d);
          e.currentTarget.playbackRate = SPEEDS[speed];
        }}
      />
      <button type="button" className="vp-play" onClick={toggle} aria-label={playing ? "Pause voice message" : "Play voice message"}>
        <Icon name={playing ? "pause" : "play"} size={18} />
      </button>
      <div className="vp-wave" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(time)} tabIndex={-1}>
        {peaks.map((p, i) => (
          <i key={i} className={i / BARS < progress ? "on" : ""} style={{ height: `${Math.round(p * 100)}%` }} />
        ))}
      </div>
      <span className="vp-time">{fmt(playing || time ? time : total)}</span>
      <button type="button" className="vp-speed" onClick={cycleSpeed} aria-label="Playback speed">
        {SPEEDS[speed]}x
      </button>
    </div>
  );
}
