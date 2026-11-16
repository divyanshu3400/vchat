"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, blockUser, reportUser, searchPeople, type PersonResult, type ReportReason } from "@/lib/api";
import { useChat } from "./ChatProvider";
import { useDock } from "./Dock";
import { Avatar, Icon } from "./bits";

const REASONS: [ReportReason, string][] = [
  ["sexual", "Sexual content"],
  ["harassment", "Harassment or hate"],
  ["underage", "Looks under 18"],
  ["spam", "Spam or bot"],
  ["scam", "Scam / asking for money"],
];
const GENDER: Record<string, string> = { M: "Man", F: "Woman", O: "Other" };

/**
 * "People on vChat" under the Chats search: anyone findable by name (2+ letters), beyond your own
 * chats. Tapping someone opens a small sheet: Message, Add friend, Block, Report.
 */
export default function PeopleSearch({ query, skip }: { query: string; skip: Set<number> }) {
  const { getAccess } = useChat();
  const [results, setResults] = useState<PersonResult[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<PersonResult | null>(null);
  const q = query.trim();
  const active = q.length >= 2;

  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await searchPeople(q, 0, await getAccess());
        if (cancelled) return;
        setResults(res.results);
        setNext(res.next);
        setError("");
        setSearched(q);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError && e.status === 429 ? "Too many searches. Try again in a while." : "Search isn't working right now.");
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, getAccess]);

  async function more() {
    if (next === null) return;
    const res = await searchPeople(q, next, await getAccess());
    setResults((r) => [...r, ...res.results.filter((x) => !r.some((y) => y.user.id === x.user.id))]);
    setNext(res.next);
  }

  if (!active) return null;
  const shown = results.filter((r) => !skip.has(r.user.id));
  const loading = searched !== q && !error;

  return (
    <>
      <div className="list-label">People on vChat</div>
      {error ? (
        <p className="list-empty">{error}</p>
      ) : loading && !shown.length ? (
        <p className="list-empty">Searching…</p>
      ) : !shown.length ? (
        <p className="list-empty">Nobody else by that name. People can turn off being found.</p>
      ) : (
        shown.map((r) => (
          <button key={r.user.id} type="button" className="conv conv-person" onClick={() => setOpen(r)}>
            <Avatar id={r.user.id} name={r.user.nickname} size={44} />
            <span className="conv-mid">
              <span className="conv-name">
                {r.user.nickname}
                {r.relation === "friend" && <span className="tag">Friend</span>}
                {r.relation === "requested" && <span className="tag">Request sent</span>}
                {r.relation === "incoming" && <span className="tag live">Wants to be friends</span>}
              </span>
              <span className="conv-preview">
                {[GENDER[r.user.gender], `Joined ${r.joined}`, r.mutual_friends ? `${r.mutual_friends} mutual` : ""].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        ))
      )}
      {next !== null && shown.length > 0 && (
        <button type="button" className="pill-btn list-more" onClick={more}>
          More people
        </button>
      )}
      {open && (
        <PersonSheet
          person={open}
          onClose={() => setOpen(null)}
          onChanged={(relation) => setResults((l) => l.map((x) => (x.user.id === open.user.id ? { ...x, relation } : x)))}
          onGone={() => {
            setResults((l) => l.filter((x) => x.user.id !== open.user.id));
            setOpen(null);
          }}
        />
      )}
    </>
  );
}

function PersonSheet({
  person,
  onClose,
  onChanged,
  onGone,
}: {
  person: PersonResult;
  onClose: () => void;
  onChanged: (relation: PersonResult["relation"]) => void;
  onGone: () => void;
}) {
  const { getAccess, addFriend, answerRequest, incoming } = useChat();
  const { openChat } = useDock();
  const [step, setStep] = useState<"main" | "report" | "block">("main");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const u = person.user;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function friend() {
    setBusy(true);
    if (person.relation === "incoming") {
      const req = incoming.find((r) => r.from_user.id === u.id);
      if (req) {
        await answerRequest(req.id, "accept").catch(() => undefined);
        onChanged("friend");
        setNote(`You and ${u.nickname} are friends now.`);
      }
    } else {
      const msg = await addFriend(u);
      setNote(msg);
      if (/sent|friends/i.test(msg)) onChanged(/friends/i.test(msg) ? "friend" : "requested");
    }
    setBusy(false);
  }

  async function block() {
    setBusy(true);
    try {
      await blockUser(u.id, await getAccess());
      onGone();
    } catch {
      setNote("Couldn't block. Try again.");
      setBusy(false);
    }
  }

  async function report(reason: ReportReason) {
    setBusy(true);
    try {
      await reportUser({ reported_user: u.id, reason }, await getAccess());
      setNote("Thanks. A moderator will look at it.");
      setStep("main");
    } catch {
      setNote("Couldn't send the report. Try again.");
    }
    setBusy(false);
  }

  return createPortal(
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={u.nickname}>
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet person-sheet">
        <span className="sheet-grab" aria-hidden="true" />
        <div className="person-head">
          <Avatar id={u.id} name={u.nickname} size={64} />
          <div>
            <h2>{u.nickname}</h2>
            <p className="muted-text">
              {[GENDER[u.gender], `Joined ${person.joined}`, person.mutual_friends ? `${person.mutual_friends} mutual friends` : ""].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {step === "main" && (
          <div className="person-actions">
            <button
              type="button"
              className="sheet-opt"
              onClick={() => {
                onClose();
                openChat(u.id);
              }}
            >
              <span className="sheet-ic reward">
                <Icon name="chat" size={20} />
              </span>
              <span>
                <b>{person.relation === "friend" ? "Message" : "Send a message"}</b>
                <small>{person.relation === "friend" ? "Open your chat" : "Goes to their message requests (text only)"}</small>
              </span>
            </button>
            {person.relation !== "friend" && (
              <button type="button" className="sheet-opt" disabled={busy || person.relation === "requested"} onClick={friend}>
                <span className="sheet-ic reward">
                  <Icon name="plus" size={20} />
                </span>
                <span>
                  <b>{person.relation === "incoming" ? "Accept friend request" : person.relation === "requested" ? "Friend request sent" : "Add friend"}</b>
                  <small>Friends can share photos and call each other</small>
                </span>
              </button>
            )}
            <div className="person-small">
              <button type="button" className="pill-btn" onClick={() => setStep("report")}>
                <Icon name="flag" size={15} /> Report
              </button>
              <button type="button" className="pill-btn danger-text" onClick={() => setStep("block")}>
                <Icon name="ban" size={15} /> Block
              </button>
            </div>
          </div>
        )}
        {step === "report" && (
          <div className="person-actions">
            <p className="muted-text">What&apos;s wrong?</p>
            {REASONS.map(([reason, label]) => (
              <button key={reason} type="button" className="sheet-opt" disabled={busy} onClick={() => report(reason)}>
                <span>
                  <b>{label}</b>
                </span>
              </button>
            ))}
            <button type="button" className="pill-btn" onClick={() => setStep("main")}>
              Back
            </button>
          </div>
        )}
        {step === "block" && (
          <div className="person-actions">
            <p>Block {u.nickname}? You won&apos;t see each other in search, rooms or random chat, and they can&apos;t message you.</p>
            <div className="person-small">
              <button type="button" className="pill-btn" onClick={() => setStep("main")}>
                Cancel
              </button>
              <button type="button" className="pill-btn danger" disabled={busy} onClick={block}>
                Block
              </button>
            </div>
          </div>
        )}
        {note && <p className="person-note">{note}</p>}
      </div>
    </div>,
    document.body,
  );
}
