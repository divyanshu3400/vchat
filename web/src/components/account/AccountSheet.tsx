"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, checkHandle, errorCode, saveAccount, type ChatUser } from "@/lib/api";

const HANDLE_RE = /^[a-z0-9][a-z0-9_.]{1,18}[a-z0-9_]$/;

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
  const [check, setCheck] = useState<{ value: string; ok: boolean; note: string } | null>(null);
  const h = username.trim().replace(/^@/, "").toLowerCase();
  const formatOk = HANDLE_RE.test(h) && !h.includes("..");

  // Is the username free? Asked 400 ms after typing stops.
  useEffect(() => {
    if (!formatOk) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkHandle(h, await getAccess());
        if (!cancelled) setCheck({ value: h, ok: res.available, note: res.available ? "Available" : res.detail });
      } catch {
        if (!cancelled) setCheck(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [h, formatOk, getAccess]);

  const hint = !h
    ? "People can find you by it. You log in with it."
    : !formatOk
      ? "3 to 20 letters, numbers, _ or . (not at the start or end)."
      : check?.value === h
        ? check.note
        : "Checking…";
  const hintClass = !h ? "fine" : !formatOk || (check?.value === h && !check.ok) ? "account-error" : check?.value === h ? "account-ok" : "fine";

  async function save(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!formatOk) return setError("Pick a username: 3 to 20 letters, numbers, _ or .");
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
            <small className={hintClass}>{hint}</small>
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
          <button className="cta wide" type="submit" disabled={busy || (check?.value === h && !check.ok)}>
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
