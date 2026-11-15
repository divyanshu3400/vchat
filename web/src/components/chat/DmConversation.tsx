"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, blockUser, fetchDmHistory, type ChatUser, type DirectMessage } from "@/lib/api";
import { useChat } from "./ChatProvider";
import { ChatHeader } from "./ChatShell";
import { Avatar, Icon } from "./bits";

function merge(prev: DirectMessage[], incoming: DirectMessage[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type Props = {
  userId: number;
  /** "page": full screen (phone, tablet, direct link). "window": a floating window on a laptop. */
  variant?: "page" | "window";
  minimized?: boolean;
  onToggleMin?: () => void;
  onClose?: () => void;
};

export default function DmConversation({ userId, variant = "page", minimized = false, onToggleMin, onClose }: Props) {
  const router = useRouter();
  const { me, getAccess, friends, conversations, relation, sendDm, subscribe, markRead, watchDm, addFriend, unfriend, socketLive } =
    useChat();
  const known = friends.find((f) => f.user.id === userId)?.user ?? conversations.find((c) => c.user.id === userId)?.user;
  const [partner, setPartner] = useState<ChatUser | null>(known ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState<"unfriend" | "block" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const rel = relation(userId);
  const isFriend = rel === "friend";
  const partnerOnline = friends.some((f) => f.user.id === userId && f.online);
  const isWindow = variant === "window";

  // History once per conversation.
  useEffect(() => {
    let cancelled = false;
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
    };
  }, [userId, getAccess]);

  // While visible (not minimised), this chat's messages don't count as unread.
  useEffect(() => (minimized ? undefined : watchDm(userId)), [userId, minimized, watchDm]);

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

  const lastFromPartner = [...messages].reverse().find((m) => m.sender.id === userId)?.id;
  useEffect(() => {
    if (lastFromPartner && !minimized) markRead(userId, lastFromPartner);
  }, [lastFromPartner, userId, markRead, minimized]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, minimized]);

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
        if (onClose) onClose();
        else router.push("/chat/inbox");
      }
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
    setConfirming(null);
    setMenuOpen(false);
  }

  const name = partner?.nickname ?? "…";
  const status = !socketLive ? "Reconnecting…" : !isFriend ? "Not friends" : partnerOnline ? "Online" : "Offline";

  const confirmBar = confirming && (
    <div className="confirm-bar" role="alertdialog" aria-label="Confirm">
      <span>{confirming === "block" ? `Block ${name}? You won't see each other again.` : `Remove ${name} from friends?`}</span>
      <button type="button" className="pill-btn danger" onClick={confirmAction}>
        {confirming === "block" ? "Block" : "Remove"}
      </button>
      <button type="button" className="pill-btn" onClick={() => setConfirming(null)}>
        Cancel
      </button>
    </div>
  );

  const menu = (
    <div className="menu-wrap">
      <button type="button" className="icon-btn" aria-label="More" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
        <Icon name="more" />
      </button>
      {menuOpen && (
        <div className="menu" role="menu">
          {isFriend && (
            <button type="button" role="menuitem" onClick={() => setConfirming("unfriend")}>
              Remove friend
            </button>
          )}
          <button type="button" role="menuitem" className="danger" onClick={() => setConfirming("block")}>
            Block
          </button>
        </div>
      )}
    </div>
  );

  const header = isWindow ? (
    <header className="win-head" onClick={(e) => !(e.target as HTMLElement).closest("button") && onToggleMin?.()}>
      <Avatar name={name} size={34} online={isFriend ? partnerOnline : undefined} />
      <div className="win-title">
        <b>{name}</b>
        <small className={partnerOnline && isFriend ? "on" : ""}>{status}</small>
      </div>
      {!minimized && menu}
      <button type="button" className="icon-btn" aria-label={minimized ? "Expand" : "Minimise"} onClick={onToggleMin}>
        <Icon name={minimized ? "expand" : "min"} size={18} />
      </button>
      <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </header>
  ) : (
    <ChatHeader
      title={name}
      back="/chat/inbox"
      avatar={<Avatar name={name} size={38} online={isFriend ? partnerOnline : undefined} />}
      subtitle={<span className={partnerOnline && isFriend ? "on" : ""}>{status}</span>}
      actions={menu}
    />
  );

  if (missing) {
    return (
      <div className={isWindow ? "win" : "conversation"}>
        {header}
        <div className="messages">
          <p className="empty">This conversation isn&apos;t available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={isWindow ? `win${minimized ? " min" : ""}` : "conversation"}>
      {header}
      {!minimized && (
        <>
          {confirmBar}
          <div className="messages" ref={listRef} onScroll={onScroll} aria-live="polite" aria-relevant="additions">
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
          <div className="composer-wrap">
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
                  <button type="button" className="inline-link" onClick={async () => partner && setNotice(await addFriend(partner))}>
                    {rel === "incoming" ? "Accept their friend request" : "Send a friend request"}
                  </button>
                )}
              </p>
            )}
            <form className="composer" onSubmit={send}>
              <input
                id={`dm-input-${userId}-${variant}`}
                className="composer-input"
                type="text"
                placeholder={isFriend ? `Message ${name}` : "Messaging is off"}
                maxLength={1000}
                autoComplete="off"
                enterKeyHint="send"
                aria-label={`Message ${name}`}
                value={draft}
                disabled={!isFriend}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="send-btn" type="submit" disabled={!isFriend || !draft.trim()} aria-label="Send">
                <Icon name="send" />
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
