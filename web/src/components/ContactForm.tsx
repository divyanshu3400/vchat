"use client";

import { FormEvent, useState } from "react";
import { ApiError, refreshSession, sendContact } from "@/lib/api";

const TOPICS: [string, string][] = [
  ["question", "A question"],
  ["problem", "Something isn't working"],
  ["abuse", "Report abuse or safety"],
  ["account", "My account or data"],
  ["plus", "vChat Plus or payments"],
  ["grievance", "Grievance (IT Rules)"],
  ["other", "Something else"],
];

export default function ContactForm() {
  const [topic, setTopic] = useState("question");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!email.trim()) return setError("Add your email so we can reply.");
    if (message.trim().length < 10) return setError("Tell us a little more (at least 10 characters).");
    setBusy(true);
    try {
      // Signed in? Then we know which account this is about.
      const session = await refreshSession().catch(() => null);
      const res = await sendContact({ topic, name: name.trim(), email: email.trim(), message: message.trim(), website }, session?.access);
      setDone(res.detail);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send. Check your connection, or email us instead.");
    }
    setBusy(false);
  }

  if (done) return <p className="contact-done" role="status">{done}</p>;

  return (
    <form className="contact-form" onSubmit={submit} noValidate>
      <label>
        What is it about?
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          {TOPICS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Your name (optional)
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" />
      </label>
      <label>
        Your email
        <input type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </label>
      <label>
        Message
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={4000}
          placeholder="For a report, add the nickname, the room or chat, and roughly when it happened."
        />
      </label>
      <label className="hp" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      <button className="cta wide" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
