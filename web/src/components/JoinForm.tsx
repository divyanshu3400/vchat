"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, fetchPremiumStatus, guestSignup, refreshSession, type ChatUser } from "@/lib/api";
import { setPlus } from "@/lib/plus";
import { findRoom } from "@/lib/rooms";

export default function JoinForm() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [gender, setGender] = useState("M");
  const [ageOk, setAgeOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existing, setExisting] = useState<ChatUser | null>(null);
  // Room pages link here as /?room=<slug>#join; otherwise people land on the app's home.
  const [room, setRoom] = useState<string | null>(null);
  const destination = room ? `/chat/${room}` : "/chat";

  useEffect(() => {
    // Room pages link here as /?room=<slug>#join.
    const wanted = new URLSearchParams(window.location.search).get("room");
    const valid = wanted && findRoom(wanted) ? wanted : null;
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        if (valid) setRoom(valid);
        if (session) {
          setExisting(session.user);
          // Plus members see no ads on public pages either.
          fetchPremiumStatus(session.access)
            .then((s) => setPlus(s.plus))
            .catch(() => undefined);
        }
      })
      .catch(() => {
        /* offline or API down: show the normal form */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const name = nickname.trim();
    if (!name) return setError("Pick a nickname first.");
    if (!ageOk) return setError("Confirm you're 18 or older to join.");
    setBusy(true);
    try {
      await guestSignup({ nickname: name, gender, age_confirmed: true });
      router.push(destination);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach vChat. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (existing) {
    return (
      <div className="join" id="join">
        <p>
          Welcome back, <b>{existing.nickname}</b>.
        </p>
        <button className="cta" type="button" onClick={() => router.push(destination)}>
          Continue chatting <span aria-hidden="true">→</span>
        </button>
        <p className="fine">
          {existing.is_guest === false ? (
            <>Signed in as {existing.email}.</>
          ) : (
            <>You&apos;re a guest on this browser. Save your account in Me to keep it everywhere.</>
          )}
        </p>
      </div>
    );
  }

  return (
    <form className="join" id="join" onSubmit={onSubmit} noValidate>
      <div className="row">
        <input
          id="nickname"
          className="input"
          type="text"
          placeholder="Pick a nickname"
          maxLength={18}
          autoComplete="off"
          aria-label="Nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <fieldset className="gender" aria-label="I am">
          {[
            ["M", "M"],
            ["F", "F"],
            ["O", "Other"],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="gender"
                id={`gender-${value}`}
                value={value}
                checked={gender === value}
                onChange={() => setGender(value)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <label className="check">
        <input id="age" type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} />
        I&apos;m 18 or older and I accept the chat rules
      </label>
      <button className="cta" type="submit" disabled={busy}>
        {busy ? "Joining…" : "Start chatting"} <span aria-hidden="true">→</span>
      </button>
      <p className="form-msg" role="status">
        {error}
      </p>
      <p className="fine">No email or phone number needed. Letters, numbers, dots and underscores only.</p>
      <p className="fine">
        Saved your account before?{" "}
        <Link href="/login" className="text-link">
          Log in
        </Link>
      </p>
    </form>
  );
}
