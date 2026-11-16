"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ApiError, openTimedMedia, type Attachment, type ViewMode } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";
import AudioPlayer from "./AudioPlayer";
import { noteOpened, useViewsLeft } from "./viewCounts";

/** What the sender picks, in order. */
export const VIEW_CHOICES: { mode: ViewMode | ""; label: string }[] = [
  { mode: "", label: "Normal" },
  { mode: "once", label: "View once" },
  { mode: "10", label: "10 s" },
  { mode: "20", label: "20 s" },
  { mode: "30", label: "30 s" },
];

const BADGE: Record<ViewMode, string> = { once: "1", "10": "10", "20": "20", "30": "30", twice: "2×" };

function rule(view: ViewMode) {
  if (view === "twice") return "Can be played 2 times";
  if (view === "once") return "View once";
  return `Disappears after ${view} seconds`;
}

/**
 * A view-once / timed photo or video, or a listen-twice voice message. The message never carries
 * a link: the recipient taps View, the server counts it and hands out a short-lived link.
 * The sender sees only whether it was opened.
 */
export default function TimedMedia({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const { getAccess } = useChat();
  const view = attachment.view as ViewMode;
  const fromServer = attachment.views_left ?? 0;
  const left = useViewsLeft(attachment.id, fromServer);
  const opened = !!attachment.opened || left < fromServer;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<{ url: string; seconds: number | null } | null>(null);

  const audio = attachment.kind === "audio";
  const what = audio ? "Voice message" : attachment.kind === "video" ? "Video" : "Photo";

  async function reveal() {
    setBusy(true);
    setError("");
    try {
      const res = await openTimedMedia(attachment.id, await getAccess());
      noteOpened(attachment.id, res.views_left);
      let url = res.url;
      if (attachment.kind === "image") {
        // A photo's link works once: download it now, show it from memory, forget it on close.
        const r = await fetch(res.url, { cache: "no-store" });
        if (!r.ok) throw new Error("load");
        url = URL.createObjectURL(await r.blob());
      }
      setOpen({ url, seconds: res.seconds });
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) noteOpened(attachment.id, 0);
      else setError(e instanceof ApiError ? e.message : "It couldn't be loaded.");
    }
    setBusy(false);
  }

  function close() {
    if (open?.url.startsWith("blob:")) URL.revokeObjectURL(open.url);
    setOpen(null);
  }

  if (audio && open) return <AudioPlayer src={open.url} autoPlay onEnded={() => setOpen(null)} />;

  let status: string;
  if (left > 0) {
    status = mine
      ? audio && opened
        ? "Played once"
        : "Not opened yet"
      : audio
        ? `${left === 1 ? "1 more play" : "Can be played 2 times"}`
        : rule(view);
  } else {
    status = opened ? (audio ? "Played" : "Opened") : "Expired";
  }

  const canOpen = !mine && left > 0;
  return (
    <div className={`timed${canOpen ? "" : " spent"}`} role="group" aria-label={`${what}, ${rule(view)}`}>
      <span className="timed-icon" aria-hidden="true">
        <Icon name={left > 0 ? (audio ? "mic" : attachment.kind === "video" ? "video" : "image") : "eye"} size={20} />
        <b className="timed-badge">{BADGE[view] ?? "1"}</b>
      </span>
      <span className="timed-text">
        <b>{what}</b>
        <small>
          {left === 0 && opened && <Icon name="eye" size={12} />} {status}
        </small>
      </span>
      {canOpen && (
        <button type="button" className="pill-btn primary timed-open" disabled={busy} onClick={reveal}>
          {busy ? "…" : audio ? "Play" : "View"}
        </button>
      )}
      {error && <small className="timed-error">{error}</small>}
      {open && !audio && <TimedViewer kind={attachment.kind} src={open.url} seconds={open.seconds} onClose={close} />}
    </div>
  );
}

const hiddenNow = () => document.visibilityState === "hidden" || !document.hasFocus();
function onFocusChange(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  window.addEventListener("blur", cb);
  window.addEventListener("focus", cb);
  return () => {
    document.removeEventListener("visibilitychange", cb);
    window.removeEventListener("blur", cb);
    window.removeEventListener("focus", cb);
  };
}

/**
 * Full screen, over everything. A countdown when it has seconds. Screenshots can't be stopped on
 * the web, so this only makes saving harder: no long-press / right-click save, no dragging, a
 * blur when you switch away, and your name on it.
 */
function TimedViewer({ kind, src, seconds, onClose }: { kind: string; src: string; seconds: number | null; onClose: () => void }) {
  const { me } = useChat();
  const [failed, setFailed] = useState(false);
  const [remaining, setRemaining] = useState(seconds);
  const [endAt] = useState(() => (seconds === null ? 0 : Date.now() + seconds * 1000));
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  const away = useSyncExternalStore(onFocusChange, hiddenNow, () => false);
  const [stamp] = useState(() => `${me?.nickname ?? ""} · ${new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`);

  // Counts down to a fixed end, so a re-render (or React's dev double-run) never restarts it.
  useEffect(() => {
    if (seconds === null) return;
    const timer = setInterval(() => {
      const r = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemaining(r);
      if (r === 0) {
        clearInterval(timer);
        closeRef.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [seconds, endAt]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const stop = (e: React.SyntheticEvent) => e.preventDefault();
  const ring = seconds && remaining !== null ? remaining / seconds : 1;

  return createPortal(
    <div className={`timed-viewer${away ? " away" : ""}`} role="dialog" aria-label="Disappearing media" onContextMenu={stop}>
      <div className="timed-stage" onDragStart={stop}>
        {failed ? (
          <p className="timed-viewer-note">This couldn&apos;t be loaded, and it can&apos;t be opened again.</p>
        ) : kind === "video" ? (
          <video
            src={src}
            autoPlay
            playsInline
            controls
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            onEnded={seconds === null ? onClose : undefined}
            onError={() => setFailed(true)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a one-time in-memory copy
          <img src={src} alt="" draggable={false} />
        )}
        {!failed && (
          <div className="timed-mark" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i}>{stamp}</span>
            ))}
          </div>
        )}
        {away && <p className="timed-away">Hidden while you&apos;re away</p>}
      </div>
      <div className="timed-top">
        {seconds !== null ? (
          <span className="timed-ring" style={{ "--p": ring } as React.CSSProperties} aria-label={`${remaining} seconds left`}>
            <b>{remaining}</b>
          </span>
        ) : (
          <span className="timed-chip">
            <Icon name="eye" size={14} /> View once
          </span>
        )}
        <button type="button" className="icon-btn timed-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
