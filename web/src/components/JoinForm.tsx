"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, fetchPremiumStatus, guestSignup, refreshSession, type ChatUser } from "@/lib/api";
import { HandleStatus, useHandleCheck } from "./HandleStatus";
import { setPlus } from "@/lib/plus";
import { findRoom } from "@/lib/rooms";

// value, label, icon path (male ♂ / female ♀ symbols)
const GENDERS: [string, string, string][] = [
  ["M", "Male", "M10 20a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM14.5 9.5 20 4M15 4h5v5"],
  ["F", "Female", "M12 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12 14v7M9 18h6"],
  ["O", "Other", ""],
];

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
  // An invite link opened before signing up comes here as /?invite=<code>#join.
  const [invite, setInvite] = useState<string | null>(null);
  const destination = invite ? `/chat/join/${invite}` : room ? `/chat/${room}` : "/chat";

  useEffect(() => {
    // Room pages link here as /?room=<slug>#join.
    const wanted = new URLSearchParams(window.location.search).get("room");
    const valid = wanted && findRoom(wanted) ? wanted : null;
    const code = new URLSearchParams(window.location.search).get("invite");
    const inviteCode = code && /^[A-Za-z0-9_-]{6,16}$/.test(code) ? code : null;
    let cancelled = false;
    refreshSession()
      .then((session) => {
        if (cancelled) return;
        if (valid) setRoom(valid);
        if (inviteCode) setInvite(inviteCode);
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

  // The name is also the @username: unique. Checked while typing; taken names get free ones to tap.
  const name = useHandleCheck(nickname, { max: 18 });
  const blocked = name.kind === "invalid" || name.kind === "taken";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const wanted = nickname.trim();
    if (!wanted) return setError("Pick a name first.");
    if (blocked) return document.getElementById("nickname")?.focus();
    if (!ageOk) return setError("Tick the box to confirm you're 18 or older.");
    setBusy(true);
    try {
      await guestSignup({ nickname: wanted, gender, age_confirmed: true });
      router.push(destination);
    } catch (err) {
      // Taken a moment ago by someone else: the check below shows it (with free names) on the next look.
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
            <>Signed in as {existing.handle ? `@${existing.handle}` : existing.email}.</>
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
          placeholder="Pick a name, e.g. night_owl"
          maxLength={18}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-label="Your name"
          aria-describedby="nickname-status"
          aria-invalid={blocked}
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value.replace(/\s/g, "_"));
            setError("");
          }}
        />
        <div id="nickname-status" className="join-status">
          <HandleStatus
            state={name}
            hint="This is also your @username. Nobody else can take it."
            loginLink
            onPick={(h) => {
              setNickname(h);
              setError("");
              document.getElementById("nickname")?.focus();
            }}
          />
        </div>
        <fieldset className="gender" aria-label="I am">
          {GENDERS.map(([value, label, icon]) => (
            <label key={value}>
              <input
                type="radio"
                name="gender"
                id={`gender-${value}`}
                value={value}
                checked={gender === value}
                onChange={() => setGender(value)}
              />
              <span>
                {icon && (
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d={icon} />
                  </svg>
                )}
                {label}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <label className="check">
        <input id="age" type="checkbox" checked={ageOk} onChange={(e) => setAgeOk(e.target.checked)} />
        I&apos;m 18 or older and I accept the chat rules
      </label>
      <button className="cta" type="submit" disabled={busy || blocked}>
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
