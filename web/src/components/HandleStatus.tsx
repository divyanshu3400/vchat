"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkHandle } from "@/lib/api";

export type HandleState =
  | { kind: "empty" }
  | { kind: "invalid"; note: string }
  | { kind: "checking" }
  | { kind: "free"; handle: string }
  | { kind: "mine" }
  | { kind: "taken"; note: string; suggestions: string[] }
  | { kind: "error" };

/** The text as a @username: lowercase, no leading "@". */
export function toHandle(text: string) {
  return text.trim().replace(/^@/, "").toLowerCase();
}

/** What's wrong with how it's written (before asking the server), or "". */
export function handleFormatProblem(name: string, max = 20): string {
  // Same rules as the server (backend/apps/accounts/names.py); it also checks reserved and rude words.
  if (name.length < 4) return "At least 4 characters.";
  if (name.length > max) return `At most ${max} characters.`;
  if (/[^A-Za-z0-9_.]/.test(name)) return "Only letters, numbers, _ and . (no spaces).";
  if (!/^[A-Za-z]/.test(name)) return "Start with a letter.";
  if (!/[A-Za-z0-9]$/.test(name)) return "End with a letter or a number.";
  if (/[_.]{2,}/.test(name)) return "No two _ or . in a row.";
  if ((name.match(/[A-Za-z]/g) ?? []).length < 2) return "Use at least 2 letters.";
  if (/\d{6,}/.test(name)) return "No long numbers (like a phone number) in a name.";
  return "";
}

/**
 * Is this @username free? Checks the format straight away and asks the server 350 ms after typing
 * stops. `mine` is the person's current one (shown as theirs, not as taken).
 */
export function useHandleCheck(text: string, opts: { access?: () => Promise<string>; mine?: string | null; max?: number } = {}): HandleState {
  const { access, mine, max = 20 } = opts;
  const handle = toHandle(text);
  const problem = handle ? handleFormatProblem(handle, max) : "";
  const [answer, setAnswer] = useState<{ handle: string; state: HandleState } | null>(null);

  useEffect(() => {
    if (!handle || problem || handle === mine) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkHandle(handle, access ? await access() : undefined);
        if (cancelled) return;
        const state: HandleState = res.available
          ? { kind: "free", handle }
          : res.reason === "taken"
            ? { kind: "taken", note: `@${handle} is already taken.`, suggestions: res.suggestions ?? [] }
            : { kind: "invalid", note: res.detail.replace(/username/gi, "name") };
        setAnswer({ handle, state });
      } catch {
        if (!cancelled) setAnswer({ handle, state: { kind: "error" } });
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [handle, problem, mine, access]);

  if (!handle) return { kind: "empty" };
  if (problem) return { kind: "invalid", note: problem };
  if (handle === mine) return { kind: "mine" };
  return answer?.handle === handle ? answer.state : { kind: "checking" };
}

/**
 * The line under a name field: checking… / ✓ available / ✕ taken, with free names to tap, and
 * (on sign-up) a way in for someone whose name it is.
 */
export function HandleStatus({
  state,
  hint,
  onPick,
  loginLink,
}: {
  state: HandleState;
  /** Shown while nothing is typed. */
  hint?: string;
  onPick: (handle: string) => void;
  /** Sign-up: "Is it yours? Log in". */
  loginLink?: boolean;
}) {
  if (state.kind === "empty") return hint ? <p className="handle-status">{hint}</p> : null;
  if (state.kind === "checking")
    return (
      <p className="handle-status checking" aria-live="polite">
        <span className="hs-spin" aria-hidden="true" /> Checking…
      </p>
    );
  if (state.kind === "free")
    return (
      <p className="handle-status ok" aria-live="polite">
        <span aria-hidden="true">✓</span> @{state.handle} is available
      </p>
    );
  if (state.kind === "mine")
    return (
      <p className="handle-status ok" aria-live="polite">
        <span aria-hidden="true">✓</span> That&apos;s your username
      </p>
    );
  if (state.kind === "error") return <p className="handle-status">Couldn&apos;t check right now. You can still try.</p>;
  if (state.kind === "invalid")
    return (
      <p className="handle-status bad" role="alert">
        <span aria-hidden="true">✕</span> {state.note}
      </p>
    );
  return (
    <div className="handle-status bad" role="alert">
      <p>
        <span aria-hidden="true">✕</span> {state.note}
        {loginLink && (
          <>
            {" "}
            <Link href="/login" className="inline-link">
              Is it yours? Log in
            </Link>
          </>
        )}
      </p>
      {state.suggestions.length > 0 && (
        <div className="handle-suggest">
          <span>Try:</span>
          {state.suggestions.map((s) => (
            <button key={s} type="button" className="handle-chip" onClick={() => onPick(s)}>
              @{s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
