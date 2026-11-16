"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, createRoom, type CustomRoom } from "@/lib/api";
import { useChat } from "../ChatProvider";

export const ROOM_EMOJIS = ["💬", "🎮", "🎵", "🎬", "⚽", "📚", "😂", "🔥", "💖", "🌙", "☕", "🎉", "🍕", "✈️", "💻", "🐶"];

/** Rooms > Create room: a name, an emoji and an optional line about it. */
export default function CreateRoomSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (room: CustomRoom) => void }) {
  const { getAccess } = useChat();
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(ROOM_EMOJIS[0]);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = name.trim().length >= 2;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      onCreated(await createRoom({ name: name.trim(), emoji, description: description.trim() }, await getAccess()));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't make the room. Try again.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Create a room">
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet edit-profile">
        <span className="sheet-grab" aria-hidden="true" />
        <h2>Create a room</h2>
        <p className="muted-text">A private room for you and your friends. Only people with the link can join.</p>

        <div className="emoji-pick" role="radiogroup" aria-label="Room emoji">
          {ROOM_EMOJIS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={emoji === e} className={emoji === e ? "on" : ""} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>

        <label className="ep-field">
          <span>Name</span>
          <input className="ep-input" value={name} maxLength={40} placeholder="Weekend gang" autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="ep-field">
          <span>About (optional)</span>
          <input
            className="ep-input"
            value={description}
            maxLength={200}
            placeholder="What's this room for?"
            autoComplete="off"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {error && <p className="ep-error">{error}</p>}
        <div className="ep-buttons">
          <button type="button" className="pill-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pill-btn primary" disabled={busy || !ok} onClick={create}>
            {busy ? "Creating…" : "Create room"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
