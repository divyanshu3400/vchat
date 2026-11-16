"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, closeAccount } from "@/lib/api";
import { Icon } from "../chat/bits";

const GRACE_DAYS = 15;

/**
 * Deactivate or delete, with the consequences spelled out.
 * Saved accounts confirm with their password; deleting also asks to type DELETE.
 */
export default function CloseAccountSheet({
  kind,
  guest,
  nickname,
  getAccess,
  onClose,
  onDone,
}: {
  kind: "deactivate" | "delete";
  guest: boolean;
  nickname: string;
  getAccess: () => Promise<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteOn] = useState(() =>
    new Date(Date.now() + GRACE_DAYS * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  );
  const del = kind === "delete";
  const ready = (guest || password.length > 0) && (!del || typed.trim() === "DELETE");

  async function go(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      await closeAccount(kind, { password, confirm: del ? "DELETE" : undefined }, await getAccess());
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work. Try again.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-labelledby="close-title">
      <button type="button" className="sheet-scrim" aria-label="Cancel" onClick={onClose} />
      <form className="sheet close-sheet" onSubmit={go}>
        <span className="sheet-grab" aria-hidden="true" />
        <span className={`close-icon${del ? " danger" : ""}`} aria-hidden="true">
          <Icon name={del ? "trash" : "lock"} size={24} />
        </span>
        <h2 id="close-title">{del ? (guest ? "Delete your account now?" : "Delete your account?") : "Deactivate your account?"}</h2>

        {del && guest ? (
          <ul className="close-points">
            <li>
              <b>{nickname}</b> is deleted right away. Guest accounts can&apos;t be recovered.
            </li>
            <li>Your friends and chats go with it. Your old messages show as ******** to others.</li>
            <li>Might come back? Save your account with an email first, then you can deactivate it instead.</li>
          </ul>
        ) : del ? (
          <ul className="close-points">
            <li>
              Your account is <b>deactivated now</b> and <b>deleted for good on {deleteOn}</b>.
            </li>
            <li>
              Changed your mind? <b>Log in before {deleteOn}</b> and the deletion is cancelled.
            </li>
            <li>Until then, others see you as &quot;vChat user&quot; and your messages as ********.</li>
            <li>After that, your friends, chats and any Plus time can&apos;t be recovered.</li>
          </ul>
        ) : (
          <ul className="close-points">
            <li>You&apos;re signed out on every device.</li>
            <li>Others see you as &quot;vChat user&quot; and your messages as ********. Nobody can message you.</li>
            <li>
              <b>Log in again any time</b> and everything comes back: your name, friends and chats.
            </li>
          </ul>
        )}

        {!guest && (
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {del && (
          <label className="close-type">
            <span>
              Type <b>DELETE</b> to confirm
            </span>
            <input className="field" value={typed} autoCapitalize="characters" autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="close-error" role="alert">
            {error}
          </p>
        )}
        <div className="close-actions">
          <button type="button" className="pill-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="pill-btn danger" disabled={!ready || busy}>
            {busy ? "…" : del ? (guest ? "Delete now" : "Delete account") : "Deactivate"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
