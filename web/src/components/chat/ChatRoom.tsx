"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ApiError,
  blockUser,
  fetchHistory,
  reportUser,
  WS_URL,
  type ChatMessage,
  type ChatUser,
  type ReportReason,
} from "@/lib/api";
import { refreshRoomPresence, useRoomPresence } from "@/lib/presence";
import { findRoom } from "@/lib/rooms";
import { HEARTBEAT_MS, useChat } from "./ChatProvider";
import { ChatHeader } from "./ChatShell";

type Status = "connecting" | "live" | "reconnecting" | "missing";

const MAX_KEPT = 500;
const REPORT_REASONS: [ReportReason, string][] = [
  ["spam", "Spam"],
  ["harassment", "Harassment"],
  ["sexual", "Sexual"],
  ["underage", "Under 18"],
  ["scam", "Scam"],
];

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_KEPT);
}

export default function ChatRoom({ slug }: { slug: string }) {
  const { me, getAccess, relation, addFriend } = useChat();
  const presenceCounts = useRoomPresence();
  const room = findRoom(slug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const [reporting, setReporting] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Connect, authenticate inside the socket, and reconnect with backoff.
  // Every (re)connect reloads recent history, so messages missed while offline appear.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    async function start() {
      let access: string;
      try {
        access = await getAccess();
        const history = await fetchHistory(slug, access);
        if (cancelled) return;
        setMessages((prev) => mergeMessages(prev, history.messages));
        setHasMore((prev) => prev || history.has_more);
      } catch (e) {
        if (cancelled || (e instanceof ApiError && e.status === 401)) return; // signed out: provider redirects
        if (e instanceof ApiError && e.status === 404) return setStatus("missing");
        return scheduleRetry();
      }

      const ws = new WebSocket(`${WS_URL}/ws/rooms/${encodeURIComponent(slug)}/`);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: access }));
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.type === "ready") {
          attempt = 0;
          setStatus("live");
          setNotice("");
          // Keeps this tab counted in the room's "N here" number.
          refreshRoomPresence();
          clearInterval(heartbeat);
          heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
          }, HEARTBEAT_MS);
        } else if (data.type === "message") {
          setMessages((prev) => mergeMessages(prev, [data.message]));
        } else if (data.type === "error") {
          setNotice(data.detail);
        }
      };
      ws.onclose = (ev) => {
        clearInterval(heartbeat);
        if (cancelled || wsRef.current !== ws) return;
        if (ev.code === 4404) return setStatus("missing");
        scheduleRetry();
      };
    }

    function scheduleRetry() {
      setStatus("reconnecting");
      attempt += 1;
      retry = setTimeout(start, Math.min(1000 * 2 ** attempt, 15_000));
    }

    start();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [slug, getAccess]);

  // Follow new messages only if the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  async function loadOlder() {
    if (!messages.length) return;
    const el = listRef.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const page = await fetchHistory(slug, await getAccess(), messages[0].id);
      stickToBottom.current = false;
      setMessages((prev) => mergeMessages(page.messages, prev).slice(0, MAX_KEPT));
      setHasMore(page.has_more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
      });
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't load older messages.");
    }
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || status !== "live") return;
    stickToBottom.current = true;
    ws.send(JSON.stringify({ type: "message", content: text, client_id: crypto.randomUUID() }));
    setDraft("");
  }

  async function block(user: ChatUser) {
    try {
      await blockUser(user.id, await getAccess());
      setBlocked((prev) => new Set(prev).add(user.id));
      setNotice(`You blocked ${user.nickname}. You won't see each other's messages.`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't block. Try again.");
    }
  }

  async function report(m: ChatMessage, reason: ReportReason) {
    setReporting(null);
    try {
      await reportUser({ reported_user: m.sender.id, message: m.id, reason }, await getAccess());
      setNotice(`Thanks. A moderator will review ${m.sender.nickname}.`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't send the report. Try again.");
    }
  }

  const visible = messages.filter((m) => !blocked.has(m.sender.id));
  // Counts refresh every 30 s; never show fewer than the one person we know is here (you).
  const hereNow = Math.max(presenceCounts?.rooms[slug] ?? 0, status === "live" ? 1 : 0);
  const statusLabel = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", missing: "Room not found" }[
    status
  ];

  return (
    <>
      <ChatHeader
        title={`# ${room?.name ?? slug}`}
        subtitle={
          <>
            <span className={`dot ${status === "live" ? "pulse" : "off"}`} /> {statusLabel}
            {status === "live" && hereNow > 0 && <> · {hereNow} here</>}
            {me && <> · you are {me.nickname}</>}
          </>
        }
      />

      <div className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {hasMore && (
          <button className="load-more" type="button" onClick={loadOlder}>
            Load earlier messages
          </button>
        )}
        {status === "missing" && (
          <p className="empty">
            This room doesn&apos;t exist. <Link href="/#rooms">Pick another room</Link>.
          </p>
        )}
        {status !== "missing" && visible.length === 0 && (
          <p className="empty">No messages yet. Say hi and get the conversation going.</p>
        )}
        {visible.map((m) => {
          const rel = relation(m.sender.id);
          const mine = rel === "self";
          return (
            <div key={m.id} className={`b${mine ? " me" : ""}`}>
              {!mine && (
                <span className="who c-rose">
                  {m.sender.nickname}
                  {rel === "friend" && <small>friend</small>}
                </span>
              )}
              <div className="t">{m.content}</div>
              {!mine && (
                <div className="msg-actions">
                  {rel === "friend" && <Link href={`/chat/dm/${m.sender.id}`}>Message</Link>}
                  {(rel === "none" || rel === "incoming") && (
                    <button type="button" onClick={async () => setNotice(await addFriend(m.sender))}>
                      {rel === "incoming" ? "Accept friend" : "Add friend"}
                    </button>
                  )}
                  {rel === "requested" && (
                    <button type="button" disabled>
                      Requested
                    </button>
                  )}
                  <button type="button" onClick={() => setReporting(reporting === m.id ? null : m.id)}>
                    Report
                  </button>
                  <button type="button" onClick={() => block(m.sender)}>
                    Block
                  </button>
                </div>
              )}
              {reporting === m.id && (
                <div className="report-menu" role="group" aria-label={`Report ${m.sender.nickname} for`}>
                  {REPORT_REASONS.map(([reason, label]) => (
                    <button key={reason} type="button" onClick={() => report(m, reason)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        {notice && (
          <p className="chat-notice" role="alert">
            {notice}
          </p>
        )}
        <form className="chat-form" onSubmit={send}>
          <input
            id="chat-input"
            className="input"
            type="text"
            placeholder={status === "live" ? "Say something nice…" : "Connecting…"}
            maxLength={1000}
            autoComplete="off"
            aria-label="Message"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="send-btn" type="submit" disabled={status !== "live" || !draft.trim()} aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 20l18-8L3 4v6l12 2-12 2z" />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}
