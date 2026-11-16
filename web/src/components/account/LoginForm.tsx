"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ApiError, forgotPassword, login, resetPassword } from "@/lib/api";

type Mode = "login" | "forgot" | "reset";

/** Log in to a saved account, or reset its password with a code from the email. */
export default function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach vChat. Check your connection and try again.");
    }
    setBusy(false);
  }

  function onLogin(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return setError("Enter your email and password.");
    run(async () => {
      const res = await login(email.trim(), password);
      if (res.deletion_cancelled) {
        try {
          sessionStorage.setItem("vchat.deletionCancelled", "1");
        } catch {
          /* private mode: no banner */
        }
      }
      router.push("/chat");
    });
  }

  function onForgot(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setError("Enter the email of your account.");
    run(async () => {
      const res = await forgotPassword(email.trim());
      setNote(res.detail);
      setPassword("");
      setCode("");
      setMode("reset");
    });
  }

  function onReset(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the email.");
    if (password.length < 8) return setError("Pick a new password of at least 8 characters.");
    run(async () => {
      await resetPassword(email.trim(), code, password);
      router.push("/chat");
    });
  }

  const passwordField = (label: string, autoComplete: string) => (
    <label className="account-field">
      <span>{label}</span>
      <span className="account-pass">
        <input
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={autoComplete === "new-password" ? "At least 8 characters" : "Your password"}
        />
        <button type="button" onClick={() => setShow((s) => !s)}>
          {show ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );

  const emailField = (
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
  );

  return (
    <div className="auth-card">
      {mode === "login" && (
        <form onSubmit={onLogin} noValidate>
          <h1>Log in</h1>
          <p className="account-why">Your saved account: same nickname, friends and chats, on any device.</p>
          {emailField}
          {passwordField("Password", "current-password")}
          {error && <p className="account-error" role="alert">{error}</p>}
          <button className="cta wide" type="submit" disabled={busy}>
            {busy ? "Logging in…" : "Log in"}
          </button>
          <p className="account-links">
            <button type="button" className="inline-link" onClick={() => { setError(""); setMode("forgot"); }}>
              Forgot password?
            </button>
            <Link className="inline-link" href="/#join">
              New here? Start chatting
            </Link>
          </p>
        </form>
      )}
      {mode === "forgot" && (
        <form onSubmit={onForgot} noValidate>
          <h1>Reset your password</h1>
          <p className="account-why">We&apos;ll email you a 6-digit code.</p>
          {emailField}
          {error && <p className="account-error" role="alert">{error}</p>}
          <button className="cta wide" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send me a code"}
          </button>
          <p className="account-links">
            <button type="button" className="inline-link" onClick={() => { setError(""); setMode("login"); }}>
              Back to log in
            </button>
          </p>
        </form>
      )}
      {mode === "reset" && (
        <form onSubmit={onReset} noValidate>
          <h1>Choose a new password</h1>
          <p className="account-why">{note} It works for 10 minutes. Not there? Look in spam.</p>
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
          {passwordField("New password", "new-password")}
          {error && <p className="account-error" role="alert">{error}</p>}
          <button className="cta wide" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save and log in"}
          </button>
          <p className="account-links">
            <button type="button" className="inline-link" onClick={() => { setError(""); setMode("forgot"); }}>
              Send a new code
            </button>
          </p>
        </form>
      )}
    </div>
  );
}
