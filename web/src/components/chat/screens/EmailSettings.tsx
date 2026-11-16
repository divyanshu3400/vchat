"use client";

import { useEffect, useState } from "react";
import { ApiError, startEmail, verifyEmail, type ChatUser } from "@/lib/api";
import { useChat } from "../ChatProvider";

/**
 * Me > Email (saved accounts): add or change the email that can reset a forgotten password.
 * Optional: accounts log in with their @username.
 */
export default function EmailSettings({ me }: { me: ChatUser }) {
  const { getAccess, replaceMe } = useChat();
  const [step, setStep] = useState<"idle" | "email" | "code">("idle");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function send() {
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a real email address.");
    setBusy(true);
    try {
      const res = await startEmail(email.trim(), await getAccess());
      setEmail(res.sent_to);
      setCode("");
      setStep("code");
      setWait(60);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the code. Try again.");
    }
    setBusy(false);
  }

  async function verify() {
    setError("");
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    try {
      replaceMe((await verifyEmail(email, code, await getAccess())).user);
      setStep("idle");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check the code. Try again.");
    }
    setBusy(false);
  }

  return (
    <section className="settings" aria-labelledby="email-title">
      <h2 id="email-title" className="settings-title">
        Login &amp; email
      </h2>
      <div className="setting">
        <span>
          <b>Username</b>
          <small>{me.handle ? `@${me.handle}: log in with this and your password` : "Pick one in Edit profile to log in with it"}</small>
        </span>
      </div>
      <div className="setting email-setting">
        <span>
          <b>Email</b>
          <small>
            {me.email
              ? `${me.email}: you can reset your password with it. Nobody else sees it.`
              : "Optional. Add one so you can reset a forgotten password."}
          </small>
        </span>
        {step === "idle" && (
          <button type="button" className={`pill-btn${me.email ? "" : " primary"}`} onClick={() => setStep("email")}>
            {me.email ? "Change" : "Add email"}
          </button>
        )}
      </div>
      {step === "email" && (
        <div className="setting email-form">
          <input
            className="ep-input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <div className="ep-buttons">
            <button type="button" className="pill-btn" onClick={() => setStep("idle")}>
              Cancel
            </button>
            <button type="button" className="pill-btn primary" disabled={busy} onClick={send}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </div>
        </div>
      )}
      {step === "code" && (
        <div className="setting email-form">
          <small className="muted-text">
            We sent a 6-digit code to <b>{email}</b>. It works for 10 minutes. Not there? Look in spam.
          </small>
          <input
            className="ep-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="••••••"
            aria-label="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && verify()}
          />
          <div className="ep-buttons">
            <button type="button" className="pill-btn" disabled={wait > 0 || busy} onClick={send}>
              {wait > 0 ? `Again in ${wait}s` : "Send again"}
            </button>
            <button type="button" className="pill-btn primary" disabled={busy || code.length !== 6} onClick={verify}>
              {busy ? "Checking…" : "Verify"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="ep-error email-error">{error}</p>}
    </section>
  );
}
