"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment } from "@/lib/api";
import { Icon } from "../bits";
import AudioPlayer from "./AudioPlayer";

/**
 * A photo, video or voice note inside a message bubble.
 * `blurUntilTap`: strangers' photos stay blurred until the receiver chooses to look.
 */
export default function MediaBubble({ attachment, blurUntilTap = false }: { attachment: Attachment; blurUntilTap?: boolean }) {
  const [revealed, setRevealed] = useState(!blurUntilTap);
  const [open, setOpen] = useState(false);
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;

  if (attachment.kind === "audio") return <AudioPlayer src={attachment.url} />;

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
        className={`media-photo${revealed ? "" : " blurred"}`}
        // A fixed frame, like other chat apps: very tall or wide photos are cropped here, shown whole on tap.
        style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.75), 1.6)) }}
        onClick={() => (revealed ? setOpen(true) : setRevealed(true))}
        aria-label={revealed ? "Open photo" : "Show photo from stranger"}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed private link, not a static asset */}
        <img src={attachment.url} alt="" loading="lazy" draggable={false} />
        {!revealed && (
          <span className="media-veil">
            <Icon name="lock" size={18} /> Tap to view photo
          </span>
        )}
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
