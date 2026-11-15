"use client";

import { useState } from "react";
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
        style={{ aspectRatio: String(Math.min(Math.max(ratio, 0.6), 1.8)) }}
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
      {open && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setOpen(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={attachment.url} alt="" />
          <button type="button" className="icon-btn lightbox-close" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
      )}
    </>
  );
}
