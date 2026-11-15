"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, blockUser, fetchDmHistory, type ChatUser, type DirectMessage } from "@/lib/api";
import { useChat } from "./ChatProvider";
import { ChatHeader } from "./ChatShell";

function merge(prev: DirectMessage[], incoming: DirectMessage[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function DmThread({ userId }: { userId: number }) {
  const router = useRouter();
  const {
    me,
    getAccess,
    friends,
    relation,
    sendDm,
    subscribe,
    markRead,
    setActiveDm,
    addFriend,
    unfriend,
    socketLive,
  } = useChat();
  const partnerOnline = friends.some((f) => f.user.id === userId && f.online);
  const [partner, setPartner] = useState<ChatUser | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<"unfriend" | "block" | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const rel = relation(userId);
  const isFriend = rel === "friend";

  // Load history; while this thread is open, its messages don't count as unread.
  useEffect(() => {
    let cancelled = false;
    setActiveDm(userId);
    getAccess()
      .then((access) => fetchDmHistory(userId, access))
      .then((res) => {
        if (cancelled) return;
        setPartner(res.partner);
        setMessages((prev) => merge(prev, res.messages));
        setHasMore(res.has_more);
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 404) setMissing(true);
      });
    return () => {
      cancelled = true;
      setActiveDm(null);
    };
  }, [userId, getAccess, setActiveDm]);

  // Live messages for this conversation.
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "dm") {
          const m = event.message;
          if (m.sender.id === userId || m.recipient_id === userId) {
            stickToBottom.current = stickToBottom.current || m.sender.id !== userId;
            setMessages((prev) => merge(prev, [m]));
          }
        } else if (event.type === "error" && event.client_id) {
          setNotice(event.detail);
        }
      }),
    [subscribe, userId],
  );

  // Tell the server what has been seen.
  const lastFromPartner = [...messages].reverse().find((m) => m.sender.id === userId)?.id;
  useEffect(() => {
    if (lastFromPartner) markRead(userId, lastFromPartner);
  }, [lastFromPartner, userId, markRead]);

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
    const res = await fetchDmHistory(userId, await getAccess(), messages[0].id);
    stickToBottom.current = false;
    setMessages((prev) => merge(res.messages, prev));
    setHasMore(res.has_more);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - fromBottom;
    });
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !isFriend) return;
    stickToBottom.current = true;
    if (sendDm(userId, text)) {
      setDraft("");
      setNotice("");
    } else {
      setNotice("You're offline. Reconnecting…");
    }
  }

  async function confirmAction() {
    try {
      if (confirming === "unfriend") {
        await unfriend(userId);
        setNotice(`You removed ${partner?.nickname ?? "this user"} from your friends.`);
      } else if (confirming === "block") {
        await blockUser(userId, await getAccess());
        router.push("/chat/random");
      }
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
    setConfirming(null);
  }

  const name = partner?.nickname ?? "…";

  if (missing) {
    return (
      <>
        <ChatHeader title="Conversation" subtitle="Not available" />
        <div className="chat-list">
          <p className="empty">This conversation isn&apos;t available.</p>
        </div>
        <div />
      </>
    );
  }

  return (
    <>
      <ChatHeader
        title={name}
        subtitle={
          <>
            <span className={`dot ${partnerOnline ? "pulse" : "off"}`} />
            {!socketLive ? "Reconnecting…" : !isFriend ? "Not friends" : partnerOnline ? "Online" : "Offline"}
          </>
        }
        actions={
          confirming ? (
            <div className="confirm">
              <span>{confirming === "block" ? `Block ${name}?` : `Remove ${name}?`}</span>
              <button type="button" className="danger" onClick={confirmAction}>
                Yes
              </button>
              <button type="button" onClick={() => setConfirming(null)}>
                No
              </button>
            </div>
          ) : (
            <div className="head-actions">
              {isFriend && (
                <button type="button" onClick={() => setConfirming("unfriend")}>
                  Unfriend
                </button>
              )}
              <button type="button" onClick={() => setConfirming("block")}>
                Block
              </button>
            </div>
          )
        }
      />

      <div className="chat-list" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {hasMore && (
          <button className="load-more" type="button" onClick={loadOlder}>
            Load earlier messages
          </button>
        )}
        {messages.length === 0 && partner && (
          <p className="empty">
            This is the start of your private chat with <b>{name}</b>. Only the two of you can see it.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender.id === me?.id;
          return (
            <div key={m.id} className={`b${mine ? " me" : ""}`}>
              <div className="t">{m.content}</div>
              <span className="when">{timeLabel(m.created_at)}</span>
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
        {!isFriend && partner && (
          <p className="chat-notice">
            You can only message friends.{" "}
            {rel === "requested" ? (
              "Your friend request is waiting."
            ) : (
              <button
                type="button"
                className="inline-link"
                onClick={async () => partner && setNotice(await addFriend(partner))}
              >
                {rel === "incoming" ? "Accept their friend request" : "Send a friend request"}
              </button>
            )}
          </p>
        )}
        <form className="chat-form" onSubmit={send}>
          <input
            id="dm-input"
            className="input"
            type="text"
            placeholder={isFriend ? `Message ${name}` : "Messaging is off"}
            maxLength={1000}
            autoComplete="off"
            aria-label={`Message ${name}`}
            value={draft}
            disabled={!isFriend}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="send-btn" type="submit" disabled={!isFriend || !draft.trim()} aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 20l18-8L3 4v6l12 2-12 2z" />
            </svg>
          </button>
        </form>
      </div>
    </>
  );
}
