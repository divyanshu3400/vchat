"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment } from "@/lib/api";
import { Icon } from "../bits";
import AudioPlayer from "./AudioPlayer";
import TimedMedia from "./TimedMedia";

// Your View / Reject choices, so a reload doesn't ask again. Kept on this device only.
const CHOICES_KEY = "vchat.mediaChoices";
const CHOICES_KEPT = 500;
type Choice = "view" | "reject";

function readChoices(): Record<string, Choice> {
  try {
    return JSON.parse(localStorage.getItem(CHOICES_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveChoice(id: string, choice: Choice) {
  try {
    const all = readChoices();
    delete all[id];
    all[id] = choice;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - CHOICES_KEPT))) delete all[k];
    localStorage.setItem(CHOICES_KEY, JSON.stringify(all));
  } catch {
    /* private mode: ask again next time */
  }
}

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A photo, video or voice note inside a message bubble.
 * `ask`: someone else's photo or video. Nothing is downloaded until you tap View; Reject hides it
 * on your side only (the sender isn't told).
 */
export default function MediaBubble({ attachment, ask = false }: { attachment: Attachment; ask?: boolean }) {
  // Chat files are kept 3 days (to keep storage small); after that only this note remains.
  if (attachment.expired && !attachment.view) {
    const what = attachment.kind === "video" ? "Video" : attachment.kind === "audio" ? "Voice note" : "Photo";
    return (
      <span className="media-expired">
        <Icon name={attachment.kind === "video" ? "video" : attachment.kind === "audio" ? "mic" : "image"} size={16} /> {what} expired
      </span>
    );
  }
  if (attachment.view) return <TimedMedia attachment={attachment} mine={!ask} />;
  return <PlainMedia attachment={attachment} ask={ask} />;
}

function PlainMedia({ attachment, ask }: { attachment: Attachment; ask: boolean }) {
  const [choice, setChoice] = useState<Choice | undefined>(() =>
    ask && typeof window !== "undefined" ? readChoices()[attachment.id] : undefined,
  );
  const [open, setOpen] = useState(false);
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;

  if (attachment.kind === "audio") return <AudioPlayer src={attachment.url} />;

  const what = attachment.kind === "video" ? "video" : "photo";
  if (ask && choice !== "view") {
    const decide = (c: Choice) => {
      saveChoice(attachment.id, c);
      setChoice(c);
    };
    if (choice === "reject") {
      return (
        <span className="media-declined">
          <Icon name="close" size={14} /> You declined this {what}.{" "}
          <button type="button" className="inline-link" onClick={() => decide("view")}>
            View anyway
          </button>
        </span>
      );
    }
    return (
      <div className="media-ask" role="group" aria-label={`A ${what} was sent to you`}>
        <span className="media-ask-icon" aria-hidden="true">
          <Icon name={attachment.kind === "video" ? "video" : "image"} size={22} />
        </span>
        <span className="media-ask-text">
          <b>{what === "video" ? "Video" : "Photo"}</b>
          <small>
            {sizeLabel(attachment.size)} · opens only if you want
          </small>
        </span>
        <span className="media-ask-actions">
          <button type="button" className="pill-btn primary" onClick={() => decide("view")}>
            View
          </button>
          <button type="button" className="pill-btn" onClick={() => decide("reject")}>
            Reject
          </button>
        </span>
      </div>
    );
  }

  if (attachment.kind === "video") {
    return (
      <video className="media-video" controls preload="metadata" playsInline src={attachment.url}>
        Your browser can&apos;t play this video.
      </video>
    );
  }

  return (
    <>
      <button
        type="button"
        className="media-photo"
        // A fixed frame, like other chat apps: very tall or wide photos are cropped here, shown whole on tap.
        style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.75), 1.6)) }}
        onClick={() => setOpen(true)}
        aria-label="Open photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed private link, not a static asset */}
        <img src={attachment.url} alt="" loading="lazy" draggable={false} />
      </button>
      {open && <Lightbox src={attachment.url} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The whole photo over everything (rendered on <body>, so no chat bubble can clip it). */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
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
  return createPortal(
    <div className="lightbox" role="dialog" aria-label="Photo" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed private link, not a static asset */}
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="icon-btn lightbox-close" aria-label="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>,
    document.body,
  );
}
