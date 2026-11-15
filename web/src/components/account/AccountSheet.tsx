"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, errorCode, startAccount, verifyAccount, type ChatUser } from "@/lib/api";

const RESEND_SECONDS = 60;

/**
 * Save a guest account: email + password, then the 6-digit code from the email.
 * It stays the same account (nickname, friends, chats); afterwards it can log in anywhere.
 */
export default function AccountSheet({
  reason,
  getAccess,
  onSaved,
  onClose,
}: {
  reason?: string;
  getAccess: () => Promise<string>;
  onSaved: (user: ChatUser) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"form" | "code">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taken, setTaken] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    setTaken(false);
    if (!email.trim() || password.length < 8) return setError("Enter your email and a password of at least 8 characters.");
    setBusy(true);
    try {
      const res = await startAccount(email.trim(), password, await getAccess());
      setEmail(res.sent_to);
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (err) {
      setTaken(errorCode(err) === "email_taken");
      setError(err instanceof ApiError ? err.message : "Couldn't reach vChat. Try again.");
    }
    setBusy(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    try {
      const res = await verifyAccount(email, code, await getAccess());
      onSaved(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach vChat. Try again.");
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
        {step === "form" ? (
          <form onSubmit={send} noValidate>
            <h2>Save your account</h2>
            <p className="account-why">
              {reason ?? "Keep your nickname, friends and chats, and log in on any device."} Guests lose everything when the
              browser forgets them.
            </p>
            <label className="account-field">
              <span>Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
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
                {error}{" "}
                {taken && (
                  <Link href="/login" className="inline-link">
                    Log in
                  </Link>
                )}
              </p>
            )}
            <button className="cta wide" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send me a code"}
            </button>
            <p className="fine">We only use your email to sign you in. Nobody in vChat can see it.</p>
          </form>
        ) : (
          <form onSubmit={verify} noValidate>
            <h2>Check your email</h2>
            <p className="account-why">
              We sent a 6-digit code to <b>{email}</b>. It works for 10 minutes. Not there? Look in spam.
            </p>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              aria-label="6-digit code"
            />
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <button className="cta wide" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Save my account"}
            </button>
            <p className="account-links">
              <button type="button" className="inline-link" disabled={wait > 0 || busy} onClick={() => send()}>
                {wait > 0 ? `Send again in ${wait}s` : "Send the code again"}
              </button>
              <button type="button" className="inline-link" onClick={() => setStep("form")}>
                Change email
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
