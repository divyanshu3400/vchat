"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ViewMode } from "@/lib/api";
import { Icon } from "../bits";
import { VIEW_CHOICES } from "./TimedMedia";

const HINT: Record<string, string> = {
  "": "Stays in the chat like any message.",
  once: "They can open it one time. Then it's gone for both of you.",
  "10": "They see it for 10 seconds, one time.",
  "20": "They see it for 20 seconds, one time.",
  "30": "They see it for 30 seconds, one time.",
};

/** Before a photo or video is sent: a look at it, a caption, and how long it can be seen. */
export default function MediaSendSheet({
  file,
  onCancel,
  onSend,
}: {
  file: File;
  onCancel: () => void;
  onSend: (view: ViewMode | "", caption: string) => void;
}) {
  const [preview] = useState(() => URL.createObjectURL(file));
  const [view, setView] = useState<ViewMode | "">("");
  const [caption, setCaption] = useState("");
  const video = file.type.startsWith("video/");

  // Freed when the sheet is answered (an effect cleanup would also run on React's dev re-mount).
  const cancel = () => {
    URL.revokeObjectURL(preview);
    onCancel();
  };
  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
  });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && cancelRef.current();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  return createPortal(
    <div className="msg-sheet-veil send-sheet-veil" onClick={cancel}>
      <form
        className="send-sheet"
        role="dialog"
        aria-label={video ? "Send a video" : "Send a photo"}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          URL.revokeObjectURL(preview);
          onSend(view, caption.trim());
        }}
      >
        <div className="send-sheet-preview">
          {video ? (
            <video src={preview} muted playsInline autoPlay loop />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a local preview
            <img src={preview} alt="" />
          )}
          {view && (
            <span className="send-sheet-flag">
              <Icon name={view === "once" ? "eye" : "timer"} size={14} /> {view === "once" ? "View once" : `${view} s`}
            </span>
          )}
        </div>
        <div className="view-choices" role="radiogroup" aria-label="Who can see it, and for how long">
          {VIEW_CHOICES.map((c) => (
            <button
              key={c.mode || "normal"}
              type="button"
              role="radio"
              aria-checked={view === c.mode}
              className={`view-chip${view === c.mode ? " on" : ""}`}
              onClick={() => setView(c.mode)}
            >
              {c.mode === "once" && <Icon name="eye" size={14} />}
              {c.mode && c.mode !== "once" && <Icon name="timer" size={14} />}
              {c.label}
            </button>
          ))}
        </div>
        <p className="send-sheet-hint">
          {HINT[view]}
          {view && " Screenshots can't be blocked, so send only what you'd be OK with them keeping."}
        </p>
        <div className="send-sheet-row">
          <input
            className="send-sheet-caption"
            placeholder="Add a caption…"
            value={caption}
            maxLength={1000}
            onChange={(e) => setCaption(e.target.value)}
          />
          <button type="button" className="pill-btn" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="send-btn" aria-label="Send">
            <Icon name="send" />
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
