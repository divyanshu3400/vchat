"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { HandleStatus, toHandle, useHandleCheck } from "@/components/HandleStatus";
import { ApiError, errorCode, saveAccount, type ChatUser } from "@/lib/api";

/**
 * Save a guest account with a @username and a password. No email needed: it stays the same
 * account (nickname, friends, chats) and can log in on any device. An email can be added later
 * in Me, so a forgotten password can be reset.
 */
export default function AccountSheet({
  reason,
  handle,
  getAccess,
  onSaved,
  onClose,
}: {
  reason?: string;
  /** The @username picked at sign-up: filled in, can be changed here. */
  handle?: string | null;
  getAccess: () => Promise<string>;
  onSaved: (user: ChatUser) => void;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(handle ?? "");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const h = toHandle(username);
  const status = useHandleCheck(username, { access: getAccess, mine: handle });
  const blocked = status.kind === "invalid" || status.kind === "taken";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!h) return setError("Pick a username.");
    if (blocked) return;
    if (password.length < 8) return setError("Pick a password of at least 8 characters.");
    setBusy(true);
    try {
      const res = await saveAccount(h, password, await getAccess());
      onSaved(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach vChat. Try again.");
      if (errorCode(err) === "already_saved") onClose();
      setBusy(false);
    }
  }

  return (
    <div className="msg-sheet-veil" onClick={onClose}>
      <div className="account-sheet" role="dialog" aria-label="Save your account" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="account-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="account-badge" aria-hidden="true">
          🔒
        </div>
        <form onSubmit={save} noValidate>
          <h2>Save your account</h2>
          <p className="account-why">
            {reason ?? "Keep your nickname, friends and chats, and log in on any device."} Guests lose everything when the
            browser forgets them.
          </p>
          <label className="account-field">
            <span>Username</span>
            <span className="account-handle">
              <i aria-hidden="true">@</i>
              <input
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                maxLength={21}
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, "").toLowerCase())}
                placeholder="yourname"
              />
            </span>
            <HandleStatus
              state={status}
              hint="You log in with it, and friends can find you by it."
              onPick={(pick) => {
                setUsername(pick);
                setError("");
              }}
            />
          </label>
          <label className="account-field">
            <span>Password</span>
            <span className="account-pass">
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                minLength={8}
              />
              <button type="button" onClick={() => setShow((s) => !s)}>
                {show ? "Hide" : "Show"}
              </button>
            </span>
          </label>
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <button className="cta wide" type="submit" disabled={busy || blocked}>
            {busy ? "Saving…" : "Save my account"}
          </button>
          <p className="fine">
            No email needed. Add one later in Me so you can reset a forgotten password.{" "}
            <Link href="/login" className="inline-link">
              Already have an account?
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
