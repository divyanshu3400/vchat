"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WatchChat, WatchState } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";
import { youtubeId } from "../messages/richText";
import { YT_STATE, loadYouTube, type YTPlayer } from "./youtube";

/** Which 1-on-1 chat the player belongs to. */
export type WatchTarget = { kind: "dm"; with: number } | { kind: "stranger"; session: string | null };

const DRIFT_SECONDS = 2;
const CHECK_MS = 2000;
const QUIET_MS = 1200;

export type Watch = {
  state: WatchState | null;
  /** server clock minus ours, in ms */
  offset: number;
  start: (video: string) => boolean;
  stop: () => void;
  control: (action: "play" | "pause" | "seek", position: number) => void;
};

/** The shared player state of one chat, kept current from the personal socket. */
export function useWatch(target: WatchTarget): Watch {
  const { me, sendRaw, subscribe, socketLive } = useChat();
  const [state, setState] = useState<WatchState | null>(null);
  const [offset, setOffset] = useState(0);
  const key = target.kind === "dm" ? `dm:${target.with}` : `st:${target.session ?? ""}`;
  // What the server expects as "chat".
  const wire = useMemo(
    () => (target.kind === "dm" ? { kind: "dm", with: target.with } : { kind: "stranger" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target
    [key],
  );

  const matches = useCallback(
    (chat: WatchChat) =>
      target.kind === "dm"
        ? chat.kind === "dm" && chat.users.includes(target.with) && (!me || chat.users.includes(me.id))
        : chat.kind === "stranger" && !!target.session && chat.session === target.session,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` identifies the target
    [key, me?.id],
  );

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "watch.state" && matches(event.chat)) {
          setOffset(event.server_now - Date.now());
          setState(event.state);
        }
      }),
    [subscribe, matches],
  );

  // What is playing in this chat right now (on opening it and after every reconnect).
  useEffect(() => {
    if (!socketLive || (target.kind === "stranger" && !target.session)) return;
    sendRaw({ type: "watch.sync", chat: wire });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `wire` follows `key`
  }, [socketLive, wire, sendRaw]);

  const start = useCallback((video: string) => sendRaw({ type: "watch.start", chat: wire, video }), [sendRaw, wire]);
  const stop = useCallback(() => {
    sendRaw({ type: "watch.stop", chat: wire });
  }, [sendRaw, wire]);
  const control = useCallback(
    (action: "play" | "pause" | "seek", position: number) =>
      sendRaw({ type: "watch.control", chat: wire, action, position: Math.round(position * 10) / 10 }),
    [sendRaw, wire],
  );

  // A random chat that ended takes its player with it.
  const live = target.kind === "dm" || !!target.session;
  return { state: live ? state : null, offset, start, stop, control };
}

function expectedAt(s: WatchState, offset: number) {
  return s.playing ? s.position + (Date.now() + offset - s.at) / 1000 : s.position;
}

/** The player strip at the top of a chat while a video is shared. */
export function WatchPanel({ watch, partnerName, meId }: { watch: Watch; partnerName: string; meId?: number }) {
  const { state, offset, control, stop } = watch;
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const quietUntil = useRef(0);
  const stateRef = useRef(state);
  const offsetRef = useRef(offset);
  const onChangeRef = useRef<(code: number) => void>(() => undefined);
  const needTapRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [needTap, setNeedTap] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const video = state?.video ?? null;

  useEffect(() => {
    stateRef.current = state;
    offsetRef.current = offset;
  }, [state, offset]);
  useEffect(() => {
    needTapRef.current = needTap;
  }, [needTap]);

  // Make the player once per shared video session; keep it while the video changes.
  const hasVideo = video !== null;
  useEffect(() => {
    if (!hasVideo) return;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    const mount = document.createElement("div");
    host.appendChild(mount);
    loadYouTube()
      .then((YT) => {
        if (cancelled || !stateRef.current) return;
        const s = stateRef.current;
        quietUntil.current = Date.now() + QUIET_MS * 2;
        playerRef.current = new YT.Player(mount, {
          host: "https://www.youtube-nocookie.com",
          videoId: s.video,
          width: "100%",
          height: "100%",
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            start: Math.floor(expectedAt(s, offsetRef.current)),
          },
          events: {
            onReady: (e) => {
              // Local development only: lets a test read the player.
              if (process.env.NODE_ENV !== "production") (window as unknown as { __watchPlayer?: YTPlayer }).__watchPlayer = e.target;
              readyRef.current = true;
              setReady(true);
              setTitle(e.target.getVideoData?.()?.title ?? "");
            },
            onStateChange: (e) => onChangeRef.current(e.data),
            onError: (e) => {
              setError(
                e.data === 101 || e.data === 150
                  ? "This video can't be played here. Its owner only allows it on YouTube."
                  : "This video can't be played right now.",
              );
            },
          },
        });
      })
      .catch(() => setError("YouTube didn't load. Check your connection."));
    return () => {
      cancelled = true;
      readyRef.current = false;
      setReady(false);
      playerRef.current?.destroy();
      playerRef.current = null;
      mount.remove();
    };
  }, [hasVideo]);

  /** Someone used the player controls here: share it, unless it was us following the other side. */
  function onLocalChange(code: number) {
    const p = playerRef.current;
    const s = stateRef.current;
    if (!p || !s) return;
    if (code === YT_STATE.PLAYING) {
      setNeedTap(false);
      setTitle(p.getVideoData?.()?.title ?? "");
    }
    if (Date.now() < quietUntil.current) return;
    const cur = p.getCurrentTime();
    const exp = expectedAt(s, offsetRef.current);
    if (code === YT_STATE.PLAYING && (!s.playing || Math.abs(cur - exp) > DRIFT_SECONDS)) control("play", cur);
    else if (code === YT_STATE.PAUSED && s.playing) control("pause", cur);
  }

  useEffect(() => {
    onChangeRef.current = onLocalChange;
  });

  // Follow the shared state: same video, same moment, playing or paused.
  useEffect(() => {
    const p = playerRef.current;
    if (!ready || !p || !state) return;
    const exp = expectedAt(state, offset);
    const current = p.getVideoData?.()?.video_id;
    if (current && current !== state.video) {
      quietUntil.current = Date.now() + QUIET_MS * 2;
      if (state.playing) p.loadVideoById({ videoId: state.video, startSeconds: exp });
      else p.cueVideoById({ videoId: state.video, startSeconds: exp });
      return;
    }
    if (Math.abs(p.getCurrentTime() - exp) > DRIFT_SECONDS) {
      quietUntil.current = Date.now() + QUIET_MS;
      p.seekTo(exp, true);
    }
    const ps = p.getPlayerState();
    if (state.playing && ps !== YT_STATE.PLAYING && ps !== YT_STATE.BUFFERING) {
      quietUntil.current = Date.now() + QUIET_MS;
      p.playVideo();
      // Phones block sound until you tap once: offer the tap if it didn't start.
      const t = setTimeout(() => {
        const now = playerRef.current?.getPlayerState();
        if (stateRef.current?.playing && now !== YT_STATE.PLAYING && now !== YT_STATE.BUFFERING) setNeedTap(true);
      }, 1500);
      return () => clearTimeout(t);
    }
    if (!state.playing && ps !== YT_STATE.PAUSED && ps !== YT_STATE.CUED) {
      quietUntil.current = Date.now() + QUIET_MS;
      p.pauseVideo();
    }
  }, [state, offset, ready]);

  // Slow networks fall behind: catch up every couple of seconds. A player stuck buffering after
  // a jump gets a nudge.
  useEffect(() => {
    if (!ready || !state?.playing) return;
    let stuck = 0;
    const id = setInterval(() => {
      const p = playerRef.current;
      const s = stateRef.current;
      if (!p || !s?.playing) return;
      if (p.getPlayerState() !== YT_STATE.PLAYING) {
        stuck += 1;
        if (stuck >= 2 && !needTapRef.current) {
          stuck = 0;
          quietUntil.current = Date.now() + QUIET_MS;
          p.seekTo(expectedAt(s, offsetRef.current), true);
          p.playVideo();
        }
        return;
      }
      stuck = 0;
      const exp = expectedAt(s, offsetRef.current);
      if (Math.abs(p.getCurrentTime() - exp) > DRIFT_SECONDS + 0.5) {
        quietUntil.current = Date.now() + QUIET_MS;
        p.seekTo(exp, true);
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [ready, state?.playing]);

  if (!state) return null;
  const startedBy = state.by === meId ? "You" : partnerName;

  return (
    <section className={`watch${minimized ? " min" : ""}`} aria-label="Watching together">
      <div className="watch-bar">
        <span className="watch-live" aria-hidden="true" />
        <div className="watch-title">
          <b>{title || "Watching together"}</b>
          <small>{state.playing ? `Playing for both of you · ${startedBy} pressed play` : `Paused by ${startedBy.toLowerCase() === "you" ? "you" : startedBy}`}</small>
        </div>
        <button type="button" className="icon-btn" aria-label={minimized ? "Show the video" : "Hide the video"} onClick={() => setMinimized((m) => !m)}>
          <Icon name={minimized ? "expand" : "min"} size={18} />
        </button>
        <button type="button" className="icon-btn" aria-label="Stop watching for both" title="Stop for both" onClick={stop}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="watch-frame">
        <div className="watch-host" ref={hostRef} />
        {needTap && !error && (
          <button
            type="button"
            className="watch-tap"
            onClick={() => {
              const p = playerRef.current;
              const s = stateRef.current;
              if (!p || !s) return;
              quietUntil.current = Date.now() + QUIET_MS;
              p.seekTo(expectedAt(s, offsetRef.current), true);
              p.playVideo();
              setNeedTap(false);
            }}
          >
            <Icon name="play" size={22} /> Tap to join {state.by === meId ? "the video" : `${partnerName}'s video`}
          </button>
        )}
        {error && (
          <div className="watch-error">
            <p>{error}</p>
            <a href={`https://www.youtube.com/watch?v=${state.video}`} target="_blank" rel="noopener noreferrer">
              Open on YouTube
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

/** "Watch together" from the chat header: paste a YouTube link. */
export function WatchStartSheet({ onStart, onClose }: { onStart: (video: string) => void; onClose: () => void }) {
  const [link, setLink] = useState("");
  const id = youtubeId(link.trim()) ?? (/^[\w-]{11}$/.test(link.trim()) ? link.trim() : null);
  return (
    <div className="msg-sheet-veil" onClick={onClose}>
      <form
        className="link-guard watch-start"
        role="dialog"
        aria-label="Watch a YouTube video together"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (id) onStart(id);
        }}
      >
        <p>
          <b className="watch-start-title">Watch together</b>
          Paste a YouTube link. It plays for both of you, in sync, and either of you can pause or skip.
        </p>
        <input
          className="watch-input"
          autoFocus
          inputMode="url"
          placeholder="https://youtu.be/…"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <div>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="go" disabled={!id}>
            Play for both
          </button>
        </div>
      </form>
    </div>
  );
}
