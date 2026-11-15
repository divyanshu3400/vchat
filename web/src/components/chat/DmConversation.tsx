"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  blockUser,
  fetchDmHistory,
  uploadMedia,
  type AttachmentKind,
  type ChatUser,
  type DirectMessage,
} from "@/lib/api";
import { useCalls } from "./calls/CallProvider";
import { voiceFilename } from "./media/useRecorder";
import Composer from "./messages/Composer";
import MessageList, { JumpToLatest, type Msg } from "./messages/MessageList";
import { useStickyScroll } from "./messages/useStickyScroll";
import { WatchPanel, WatchStartSheet, useWatch } from "./watch/WatchTogether";
import { useChat } from "./ChatProvider";
import { ChatHeader } from "./ChatShell";
import { Avatar, Icon } from "./bits";

function merge(prev: DirectMessage[], incoming: DirectMessage[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const TYPING_SHOW_MS = 3500;
const TYPING_SEND_GAP_MS = 2000;
// Errors from a react/edit/delete just sent from this chat.
const OP_ERRORS = new Set(["too_late", "not_yours", "gone", "not_found", "invalid_reaction", "not_text", "invalid_message"]);

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
  const { me, getAccess, friends, conversations, relation, sendDm, sendRaw, subscribe, markRead, watchDm, addFriend, unfriend, socketLive } =
    useChat();
  const known = friends.find((f) => f.user.id === userId)?.user ?? conversations.find((c) => c.user.id === userId)?.user;
  const [partner, setPartner] = useState<ChatUser | null>(known ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [replying, setReplying] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [partnerRead, setPartnerRead] = useState(0);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);
  const lastOpAt = useRef(0);
  const [confirming, setConfirming] = useState<"unfriend" | "block" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [watchSheet, setWatchSheet] = useState(false);
  const watch = useWatch({ kind: "dm", with: userId });
  const rel = relation(userId);
  const isFriend = rel === "friend";
  const partnerOnline = friends.some((f) => f.user.id === userId && f.online);
  const { start: startCall } = useCalls();
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
        setPartnerRead((r) => Math.max(r, res.partner_read_id ?? 0));
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
        if (event.type === "dm" || event.type === "dm.update") {
          const m = event.message;
          if (m.sender.id === userId || m.recipient_id === userId) {
            setMessages((prev) => merge(prev, [m]));
            if (event.type === "dm" && m.sender.id === userId) {
              clearTimeout(typingTimer.current);
              setPartnerTyping(false);
            }
          }
        } else if (event.type === "dm.read" && event.user_id === userId) {
          setPartnerRead((r) => Math.max(r, event.last_id));
        } else if (event.type === "dm.typing" && event.user_id === userId) {
          setPartnerTyping(true);
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setPartnerTyping(false), TYPING_SHOW_MS);
        } else if (event.type === "error" && (event.client_id || (OP_ERRORS.has(event.code) && Date.now() - lastOpAt.current < 4000))) {
          setNotice(event.detail);
        }
      }),
    [subscribe, userId],
  );

  const lastFromPartner = [...messages].reverse().find((m) => m.sender.id === userId)?.id;
  useEffect(() => {
    if (lastFromPartner && !minimized) markRead(userId, lastFromPartner);
  }, [lastFromPartner, userId, markRead, minimized]);

  const scroll = useStickyScroll(listRef, messages.length, [minimized, partnerTyping]);

  const items = useMemo<Msg[]>(
    () =>
      messages.map((m) => ({
        id: m.id,
        mine: m.sender.id === me?.id,
        senderId: m.sender.id,
        content: m.content,
        attachment: m.attachment,
        createdAt: m.created_at,
        replyTo: m.reply_to,
        reactions: m.reactions ?? {},
        edited: m.edited,
        deleted: m.deleted,
        status: m.sender.id === me?.id ? (m.id <= partnerRead ? "seen" : "sent") : undefined,
      })),
    [messages, me?.id, partnerRead],
  );

  const op = useCallback(
    (payload: Record<string, unknown>) => {
      lastOpAt.current = Date.now();
      if (!sendRaw(payload)) setNotice("You're offline. Reconnecting…");
    },
    [sendRaw],
  );
  const onReact = useCallback((id: number, emoji: string | null) => op({ type: "dm.react", message_id: id, emoji }), [op]);
  const onDelete = useCallback((m: Msg) => op({ type: "dm.delete", message_id: m.id }), [op]);
  const onReply = useCallback((m: Msg) => {
    setEditing(null);
    setReplying(m);
  }, []);
  const onEdit = useCallback((m: Msg) => {
    setReplying(null);
    setEditing(m);
  }, []);

  async function loadOlder() {
    if (!messages.length) return;
    const el = listRef.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    const res = await fetchDmHistory(userId, await getAccess(), messages[0].id);
    scroll.hold();
    setMessages((prev) => merge(res.messages, prev));
    setHasMore(res.has_more);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - fromBottom;
    });
  }

  function send(text: string): boolean {
    if (!isFriend) return false;
    if (editing) {
      lastOpAt.current = Date.now();
      if (!sendRaw({ type: "dm.edit", message_id: editing.id, content: text })) {
        setNotice("You're offline. Reconnecting…");
        return false;
      }
      setEditing(null);
      return true;
    }
    scroll.follow();
    if (!sendDm(userId, text, undefined, replying?.id)) {
      setNotice("You're offline. Reconnecting…");
      return false;
    }
    setNotice("");
    setReplying(null);
    return true;
  }

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_GAP_MS) return;
    lastTypingSent.current = now;
    sendRaw({ type: "dm.typing", to: userId });
  }

  async function sendFile(file: Blob, kind: AttachmentKind, filename: string) {
    if (!isFriend) return;
    setNotice("");
    scroll.follow();
    setUploading(0);
    const replyTo = replying?.id;
    setReplying(null);
    try {
      const up = await uploadMedia(file, kind, await getAccess(), setUploading, filename);
      if (!sendDm(userId, "", up.id, replyTo)) setNotice("You're offline. Reconnecting…");
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't send that file.");
    }
    setUploading(null);
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
  const status = !socketLive
    ? "Reconnecting…"
    : !isFriend
      ? "Not friends"
      : partnerTyping
        ? "typing…"
        : partnerOnline
          ? "Online"
          : "Offline";

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

  const callButtons = isFriend && partner && (
    <>
      <button type="button" className="icon-btn" aria-label="Watch YouTube together" title="Watch together" onClick={() => setWatchSheet(true)}>
        <Icon name="play" size={isWindow ? 18 : 20} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Voice call ${name}`} onClick={() => startCall(partner, "voice")}>
        <Icon name="phone" size={isWindow ? 18 : 20} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Video call ${name}`} onClick={() => startCall(partner, "video")}>
        <Icon name="video" size={isWindow ? 18 : 20} />
      </button>
    </>
  );

  const header = isWindow ? (
    <header className="win-head" onClick={(e) => !(e.target as HTMLElement).closest("button") && onToggleMin?.()}>
      <Avatar name={name} size={34} online={isFriend ? partnerOnline : undefined} />
      <div className="win-title">
        <b>{name}</b>
        <small className={partnerOnline && isFriend ? "on" : ""}>{status}</small>
      </div>
      {!minimized && callButtons}
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
      actions={
        <>
          {callButtons}
          {menu}
        </>
      }
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
          <WatchPanel watch={watch} partnerName={name} meId={me?.id} />
          {watchSheet && (
            <WatchStartSheet
              onClose={() => setWatchSheet(false)}
              onStart={(video) => {
                setWatchSheet(false);
                if (!watch.start(video)) setNotice("You're offline. Reconnecting…");
              }}
            />
          )}
          <div className="messages" ref={listRef} onScroll={scroll.onScroll} aria-live="polite" aria-relevant="additions">
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
            <MessageList
              items={items}
              me={me ?? undefined}
              onReact={onReact}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onWatch={isFriend ? (video) => watch.start(video) : undefined}
            />
            {uploading !== null && (
              <div className="m me last uploading">
                <div className="m-row">
                  <div className="bubble">
                    <span className="txt">Sending… {Math.round(uploading * 100)}%</span>
                  </div>
                </div>
              </div>
            )}
            {partnerTyping && (
              <div className="typing" aria-label={`${name} is typing`}>
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <JumpToLatest away={scroll.away} unseen={scroll.unseen} onClick={scroll.jump} />
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
            <Composer
              id={`dm-input-${userId}-${variant}`}
              placeholder={isFriend ? `Message ${name}` : "Messaging is off"}
              disabled={!isFriend}
              onSend={send}
              onTyping={sendTyping}
              replying={replying}
              replyName={replying ? (replying.mine ? "yourself" : name) : undefined}
              onCancelReply={() => setReplying(null)}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
              onVoice={(blob) => sendFile(blob, "audio", voiceFilename(blob))}
              left={
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/mp4,video/webm"
                    hidden
                    id={`dm-file-${userId}-${variant}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) sendFile(file, file.type.startsWith("video/") ? "video" : "image", file.name);
                    }}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Send a photo or video"
                    disabled={!isFriend || uploading !== null}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Icon name="image" />
                  </button>
                </>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
