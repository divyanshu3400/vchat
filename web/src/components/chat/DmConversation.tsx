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
  type ViewMode,
  type ChatPrefs,
  type ChatState,
  answerMessageRequest,
  setChatPrefs,
} from "@/lib/api";
import { useCalls } from "./calls/CallProvider";
import MediaSendSheet from "./media/MediaSendSheet";
import { voiceFilename } from "./media/useRecorder";
import Composer from "./messages/Composer";
import MessageList, { JumpToLatest, type Msg } from "./messages/MessageList";
import { useStickyScroll } from "./messages/useStickyScroll";
import { WatchPanel, WatchStartSheet, useWatch } from "./watch/WatchTogether";
import { useChat } from "./ChatProvider";
import { ChatHeader } from "./ChatShell";
import { Avatar, Icon, lastSeenLabel } from "./bits";
import Dropdown, { DropItem, DropSep } from "./Dropdown";

function merge(prev: DirectMessage[], incoming: DirectMessage[]) {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

const AUTO_DELETE_DAYS = [1, 7, 30, 365];
const AUTO_DELETE_SHORT: Record<number, string> = { 1: "1 day", 7: "1 week", 30: "1 month", 365: "1 year" };
const AUTO_DELETE_LABEL: Record<number, string> = { 1: "1 day", 7: "1 week", 30: "1 month", 365: "1 year" };
// Outside the component: only ever called from event handlers.
const clock = () => Date.now();
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

/** Which mute option is in effect: "always" without an end, else the closest of 8 hours / 1 week. */
function muteChoice(until: string | null) {
  if (!until) return "always";
  return new Date(until).getTime() - Date.now() <= 9 * 3_600_000 ? "8h" : "1w";
}

export default function DmConversation({ userId, variant = "page", minimized = false, onToggleMin, onClose }: Props) {
  const router = useRouter();
  const { me, getAccess, friends, conversations, relation, sendDm, sendRaw, subscribe, markRead, watchDm, addFriend, unfriend, socketLive, unread, queueDm, outbox, retryDm, discardDm, askAccount } =
    useChat();
  // Unread when the chat was opened: "N new messages" goes above the first of them.
  const [unreadAtOpen] = useState(() => unread[userId] ?? 0);
  const jumpedToNew = useRef(false);
  const unreadElsewhere = Object.entries(unread).reduce((n, [id, c]) => (Number(id) === userId ? n : n + c), 0);
  const [settingNote, setSettingNote] = useState("");
  const known = friends.find((f) => f.user.id === userId)?.user ?? conversations.find((c) => c.user.id === userId)?.user;
  const [partner, setPartner] = useState<ChatUser | null>(known ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const [notice, setNotice] = useState("");
  const [replying, setReplying] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [partnerRead, setPartnerRead] = useState(0);
  const [autoDelete, setAutoDelete] = useState(7);
  const [prefs, setPrefs] = useState<ChatPrefs>({ muted: false, muted_until: null, pinned: false });
  // Message requests between people who aren't friends (see ChatState).
  const [chatState, setChatState] = useState<ChatState | null>(null);
  const [requestLeft, setRequestLeft] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);
  const lastOpAt = useRef(0);
  const [confirming, setConfirming] = useState<"unfriend" | "block" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [watchSheet, setWatchSheet] = useState(false);
  const watch = useWatch({ kind: "dm", with: userId });
  const rel = relation(userId);
  // A deactivated or deleted account: the old chat stays readable (as "********"), nothing can be sent.
  const gone = !!partner?.inactive;
  const isFriend = rel === "friend" && !gone;
  const requestState = isFriend ? "friend" : (chatState ?? "none");
  // Text (and GIFs once accepted) works without being friends; photos, voice and calls don't.
  const canText =
    isFriend ||
    (!gone &&
      (requestState === "accepted" ||
        requestState === "incoming" ||
        requestState === "declined" ||
        ((requestState === "outgoing" || requestState === "none") && me?.is_guest === false && (requestLeft ?? 3) > 0)));

  async function answerRequest(action: "accept" | "delete") {
    try {
      const res = await answerMessageRequest(userId, action, await getAccess());
      if (action === "delete") {
        if (onClose) onClose();
        else router.push("/chat/inbox");
      } else setChatState(res.chat_state);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
  }
  const partnerOnline = friends.some((f) => f.user.id === userId && f.online);
  const partnerLastSeen = friends.find((f) => f.user.id === userId)?.last_seen ?? null;

  async function changePrefs(body: { mute?: string; pin?: boolean }) {
    try {
      setPrefs(await setChatPrefs(userId, body, await getAccess()));
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "That didn't work. Try again.");
    }
  }
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
        setAutoDelete(res.auto_delete_days ?? 7);
        if (res.prefs) setPrefs(res.prefs);
        setChatState(res.chat_state ?? null);
        setRequestLeft(res.request_messages_left ?? null);
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
        } else if (event.type === "dm.settings" && event.users.includes(userId)) {
          setAutoDelete(event.auto_delete_days);
          setSettingNote(
            `${event.by.id === userId ? event.by.nickname : "You"} set messages to delete after ${AUTO_DELETE_LABEL[event.auto_delete_days] ?? `${event.auto_delete_days} days`}.`,
          );
        } else if (event.type === "conversations.changed") {
          // A random chat with this person moved in here: reload.
          getAccess()
            .then((access) => fetchDmHistory(userId, access))
            .then((res) => {
              setMessages((prev) => merge(prev, res.messages));
              // A request accepted (or a new one) changes what this chat allows.
              setChatState(res.chat_state ?? null);
              setRequestLeft(res.request_messages_left ?? null);
            })
            .catch(() => undefined);
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
    [subscribe, userId, getAccess],
  );

  const lastFromPartner = [...messages].reverse().find((m) => m.sender.id === userId)?.id;
  useEffect(() => {
    if (lastFromPartner && !minimized) markRead(userId, lastFromPartner);
  }, [lastFromPartner, userId, markRead, minimized]);

  const scroll = useStickyScroll(listRef, messages.length, [minimized, partnerTyping]);

  const items = useMemo<Msg[]>(
    () => [
      ...messages.map((m) => ({
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
        status: m.sender.id === me?.id ? (m.id <= partnerRead ? ("seen" as const) : ("sent" as const)) : undefined,
      })),
      // Written but not confirmed yet: shown at once, with a clock (or "Not sent · Retry").
      ...outbox
        .filter((o) => o.to === userId)
        .map((o, i) => ({
          id: -1_000_000 - i,
          mine: true,
          senderId: me?.id ?? 0,
          content: o.content,
          attachment: null,
          createdAt: o.createdAt,
          replyTo: o.replyTo,
          reactions: {},
          edited: false,
          deleted: false,
          pending: { state: o.state, error: o.error, key: o.clientId },
        })),
    ],
    [messages, me?.id, partnerRead, outbox, userId],
  );

  const newFrom = useMemo(() => {
    if (!unreadAtOpen) return null;
    const theirs = messages.filter((m) => m.sender.id === userId && !m.deleted);
    const first = theirs[Math.max(0, theirs.length - unreadAtOpen)];
    return first ? { id: first.id, count: Math.min(unreadAtOpen, theirs.length) } : null;
  }, [messages, unreadAtOpen, userId]);

  // Opening a chat with new messages: start at the "new messages" line, not the very bottom.
  useEffect(() => {
    if (!newFrom || jumpedToNew.current) return;
    jumpedToNew.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => listRef.current?.querySelector("[data-new-sep]")?.scrollIntoView({ block: "start" })),
    );
  }, [newFrom]);

  const op = useCallback(
    (payload: Record<string, unknown>) => {
      lastOpAt.current = clock();
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
    if (!canText) return false;
    if (editing) {
      lastOpAt.current = clock();
      if (!sendRaw({ type: "dm.edit", message_id: editing.id, content: text })) {
        setNotice("You're offline. Reconnecting…");
        return false;
      }
      setEditing(null);
      return true;
    }
    scroll.follow();
    // Shown at once; sent now, or by itself when the connection is back.
    queueDm(
      userId,
      text,
      replying
        ? {
            id: replying.id,
            sender_id: replying.senderId,
            nickname: replying.mine ? (me?.nickname ?? "You") : name,
            text: replying.content,
            kind: replying.attachment?.kind ?? null,
            deleted: false,
          }
        : null,
    );
    setNotice("");
    setReplying(null);
    if (requestState === "none" || requestState === "outgoing") {
      setChatState("outgoing");
      setRequestLeft((n) => Math.max(0, (n ?? 3) - 1));
    } else if (requestState === "incoming" || requestState === "declined") {
      setChatState("accepted"); // writing back accepts their request
    }
    return true;
  }

  function sendTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_SEND_GAP_MS) return;
    lastTypingSent.current = now;
    sendRaw({ type: "dm.typing", to: userId });
  }

  async function sendFile(file: Blob, kind: AttachmentKind, filename: string, view: ViewMode | "" = "", caption = "") {
    if (!isFriend) return;
    setNotice("");
    scroll.follow();
    setUploading(0);
    const replyTo = replying?.id;
    setReplying(null);
    try {
      const up = await uploadMedia(file, kind, await getAccess(), setUploading, filename, view);
      if (!sendDm(userId, caption, up.id, replyTo)) setNotice("You're offline. Reconnecting…");
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
  const status = gone
    ? "Account not active"
    : !socketLive
    ? "Reconnecting…"
    : !isFriend
      ? requestState === "accepted"
        ? "Chat · not friends"
        : requestState === "outgoing"
          ? "Message request sent"
          : requestState === "incoming" || requestState === "declined"
            ? "Wants to chat with you"
            : "Not friends"
      : partnerTyping
        ? "typing…"
        : partnerOnline
          ? "Online"
          : partnerLastSeen
            ? lastSeenLabel(partnerLastSeen)
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

  function chooseAutoDelete(days: number) {
    setMenuOpen(false);
    if (days !== autoDelete && !sendRaw({ type: "dm.autodelete", to: userId, days })) setNotice("You're offline. Reconnecting…");
  }

  const menu = (
    <Dropdown open={menuOpen} onToggle={() => setMenuOpen((o) => !o)} onClose={() => setMenuOpen(false)} label="More">
      {isFriend && (
        <DropItem icon="play" tone="red" hint="Play a video for both of you" onClick={() => { setMenuOpen(false); setWatchSheet(true); }}>
          Watch YouTube together
        </DropItem>
      )}
      {isFriend && (
        <div className="dd-group" role="group" aria-label="Delete messages after">
          <span className="dd-group-head">
            <span className="dd-ic tone-amber" aria-hidden="true">
              <Icon name="timer" size={18} />
            </span>
            <span className="dd-text">
              <b>Disappearing messages</b>
              <small>Delete messages after</small>
            </span>
          </span>
          <span className="dd-seg">
            {AUTO_DELETE_DAYS.map((d) => (
              <button key={d} type="button" className={d === autoDelete ? "on" : ""} aria-pressed={d === autoDelete} onClick={() => chooseAutoDelete(d)}>
                {AUTO_DELETE_SHORT[d]}
              </button>
            ))}
          </span>
        </div>
      )}
      {(isFriend || prefs.pinned) && (
        <DropItem icon="pin" tone="blue" hint={prefs.pinned ? "Stays on top of your chats" : undefined} onClick={() => { setMenuOpen(false); changePrefs({ pin: !prefs.pinned }); }}>
          {prefs.pinned ? "Unpin chat" : "Pin chat"}
        </DropItem>
      )}
      <div className="dd-group" role="group" aria-label="Mute notifications">
        <span className="dd-group-head">
          <span className="dd-ic tone-brand" aria-hidden="true">
            <Icon name={prefs.muted ? "belloff" : "bell"} size={18} />
          </span>
          <span className="dd-text">
            <b>{prefs.muted ? "Muted" : "Mute notifications"}</b>
            <small>
              {prefs.muted
                ? prefs.muted_until
                  ? `Until ${new Date(prefs.muted_until).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                  : "Until you turn it back on"
                : "No notifications or banners from this chat"}
            </small>
          </span>
        </span>
        <span className="dd-seg">
          {([["8h", "8 hours"], ["1w", "1 week"], ["always", "Always"], ["off", "Off"]] as const).map(([key, label]) => {
            const on = key === "off" ? !prefs.muted : prefs.muted && muteChoice(prefs.muted_until) === key;
            return (
              <button key={key} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => changePrefs({ mute: key })}>
                {label}
              </button>
            );
          })}
        </span>
      </div>
      <DropSep />
      {isFriend && (
        <DropItem icon="userminus" tone="muted" onClick={() => { setMenuOpen(false); setConfirming("unfriend"); }}>
          Remove friend
        </DropItem>
      )}
      <DropItem icon="ban" tone="danger" onClick={() => { setMenuOpen(false); setConfirming("block"); }}>
        Block
      </DropItem>
    </Dropdown>
  );

  const callButtons = isFriend && partner && (
    <>
      <button type="button" className="icon-btn" aria-label={`Voice call ${name}`} onClick={() => startCall(partner, "voice")}>
        <Icon name="phone" size={isWindow ? 18 : 20} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Video call ${name}`} onClick={() => startCall(partner, "video")}>
        <Icon name="video" size={isWindow ? 18 : 20} />
      </button>
    </>
  );

  const header = isWindow ? (
    <header className="win-head" onClick={(e) => !(e.target as HTMLElement).closest("button, .dd") && onToggleMin?.()}>
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
      backBadge={unreadElsewhere}
      onTitleClick={() => setProfileOpen(true)}
      avatar={<Avatar name={name} size={36} online={isFriend ? partnerOnline : undefined} />}
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
              <div className="say-hello">
                <span className="say-hello-wave" aria-hidden="true">
                  👋
                </span>
                <p>
                  This is the start of your private chat with <b>{name}</b>. Only the two of you can see it.
                </p>
                {isFriend && (
                  <div className="say-hello-chips">
                    {["Hi 👋", "Hello!", "How's your day going?"].map((t) => (
                      <button key={t} type="button" className="pill-btn" onClick={() => send(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {isFriend && (
              <button type="button" className="sys-line autodel-line" onClick={() => setProfileOpen(true)}>
                🕑 Messages here delete after {AUTO_DELETE_LABEL[autoDelete] ?? `${autoDelete} days`} · Change
              </button>
            )}
            <MessageList
              items={items}
              me={me ?? undefined}
              onReact={onReact}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onWatch={isFriend ? (video) => watch.start(video) : undefined}
              onRetry={(m) => m.pending && retryDm(m.pending.key)}
              onDiscard={(m) => m.pending && discardDm(m.pending.key)}
              newFrom={newFrom}
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
          {settingNote && (
            <p className="chat-notice setting-note" role="status" onAnimationEnd={() => setSettingNote("")}>
              {settingNote}
            </p>
          )}
          {profileOpen && partner && (
            <div className="msg-sheet-veil" onClick={() => setProfileOpen(false)}>
              <div className="account-sheet profile-sheet" role="dialog" aria-label={`About ${name}`} onClick={(e) => e.stopPropagation()}>
                <button type="button" className="account-x" aria-label="Close" onClick={() => setProfileOpen(false)}>
                  ×
                </button>
                <div className="profile-top">
                  <Avatar name={name} size={64} online={isFriend ? partnerOnline : undefined} />
                  <div>
                    <h2>{name}</h2>
                    <p className="account-why">
                      {isFriend ? (partnerOnline ? "Online" : "Offline") : "Not friends"}
                      {partner.gender ? ` · ${({ M: "Man", F: "Woman", O: "Other" } as Record<string, string>)[partner.gender] ?? ""}` : ""}
                    </p>
                  </div>
                </div>
                {isFriend && (
                  <div className="profile-actions">
                    <button type="button" onClick={() => { setProfileOpen(false); startCall(partner, "voice"); }}>
                      <Icon name="phone" /> Call
                    </button>
                    <button type="button" onClick={() => { setProfileOpen(false); startCall(partner, "video"); }}>
                      <Icon name="video" /> Video
                    </button>
                    <button type="button" onClick={() => { setProfileOpen(false); setWatchSheet(true); }}>
                      <Icon name="play" /> Watch
                    </button>
                  </div>
                )}
                {isFriend && (
                  <div className="menu-group">
                    <span className="menu-label">Delete messages after</span>
                    <div className="menu-chips">
                      {AUTO_DELETE_DAYS.map((d) => (
                        <button key={d} type="button" className={d === autoDelete ? "on" : ""} aria-pressed={d === autoDelete} onClick={() => chooseAutoDelete(d)}>
                          {AUTO_DELETE_SHORT[d]}
                        </button>
                      ))}
                    </div>
                    <small className="menu-hint">For both of you. Either of you can change it.</small>
                  </div>
                )}
                <button type="button" className="pill-btn danger" onClick={() => { setProfileOpen(false); setConfirming("block"); }}>
                  Block {name}
                </button>
              </div>
            </div>
          )}
          <div className="composer-wrap">
            {notice && (
              <p className="chat-notice" role="alert">
                {notice}
              </p>
            )}
            {gone && <p className="chat-notice">This account isn&apos;t active. You can&apos;t message or call it.</p>}
            {!gone && !isFriend && partner && (requestState === "incoming" || requestState === "declined") && (
              <div className="request-bar" role="group" aria-label="Message request">
                <p>
                  <b>{name} wants to chat with you.</b> They can&apos;t send photos or call unless you become friends.
                </p>
                <span>
                  <button type="button" className="pill-btn primary" onClick={() => answerRequest("accept")}>
                    Accept
                  </button>
                  <button type="button" className="pill-btn" onClick={() => answerRequest("delete")}>
                    Delete
                  </button>
                  <button type="button" className="pill-btn danger-text" onClick={() => setConfirming("block")}>
                    Block
                  </button>
                </span>
              </div>
            )}
            {!gone && !isFriend && partner && requestState !== "incoming" && requestState !== "declined" && (
              <p className="chat-notice">
                {me?.is_guest !== false && requestState !== "accepted" ? (
                  <>
                    Save your account to message people who aren&apos;t your friends.{" "}
                    <button type="button" className="inline-link" onClick={() => askAccount()}>
                      Save my account
                    </button>
                  </>
                ) : requestState === "accepted" ? (
                  "You're chatting without being friends: text and GIFs only. "
                ) : requestState === "outgoing" ? (
                  requestLeft === 0 ? (
                    "Your message request is waiting. You can write again once they accept. "
                  ) : (
                    `Message request sent: ${requestLeft} more ${requestLeft === 1 ? "message" : "messages"} until they accept. `
                  )
                ) : (
                  "Your first message goes to their message requests (text only, up to 3 until they accept). "
                )}
                {me?.is_guest === false &&
                  (rel === "requested" ? (
                    "Friend request sent."
                  ) : (
                    <button type="button" className="inline-link" onClick={async () => partner && setNotice(await addFriend(partner))}>
                      {rel === "incoming" ? "Accept their friend request" : "Add friend"}
                    </button>
                  ))}
              </p>
            )}
            <Composer
              id={`dm-input-${userId}-${variant}`}
              draftKey={`dm:${userId}`}
              placeholder={canText ? `Message ${name}` : gone ? "Messaging is off" : "Waiting for them to accept"}
              disabled={!canText}
              onSend={send}
              onTyping={sendTyping}
              replying={replying}
              replyName={replying ? (replying.mine ? "yourself" : name) : undefined}
              onCancelReply={() => setReplying(null)}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
              onVoice={isFriend ? (blob, view) => sendFile(blob, "audio", voiceFilename(blob), view) : undefined}
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
                      if (file) setPicked(file);
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
                  {picked && (
                    <MediaSendSheet
                      file={picked}
                      onCancel={() => setPicked(null)}
                      onSend={(view, caption) => {
                        setPicked(null);
                        sendFile(picked, picked.type.startsWith("video/") ? "video" : "image", picked.name, view, caption);
                      }}
                    />
                  )}
                </>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
