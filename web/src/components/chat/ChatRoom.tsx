"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  blockUser,
  fetchCustomRoom,
  fetchHistory,
  reportUser,
  wsUrl,
  type ChatMessage,
  type ChatUser,
  type CustomRoom,
  type ReportReason,
} from "@/lib/api";
import { refreshRoomPresence, useRoomPresence } from "@/lib/presence";
import { findRoom } from "@/lib/rooms";
import { HEARTBEAT_MS, useChat } from "./ChatProvider";
import { ChatHeader } from "./ChatShell";
import { useDock } from "./Dock";
import Composer from "./messages/Composer";
import MessageList, { JumpToLatest, type Msg, type MsgAction } from "./messages/MessageList";
import { useStickyScroll } from "./messages/useStickyScroll";
import { useRouter } from "next/navigation";
import { Icon } from "./bits";
import RoomInfoPanel from "./rooms/RoomInfoPanel";
import RoomInfoSheet from "./rooms/RoomInfoSheet";

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
  const { openChat } = useDock();
  const presenceCounts = useRoomPresence();
  const room = findRoom(slug);
  // A room someone made (private, joined by link): its name comes from the API.
  const custom = slug.startsWith("c-");
  const [info, setInfo] = useState<CustomRoom | null>(null);
  const [sheet, setSheet] = useState(false);
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<Status>("connecting");
  const [notice, setNotice] = useState("");
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const [reporting, setReporting] = useState<ChatMessage | null>(null);
  const [replying, setReplying] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

      const ws = new WebSocket(wsUrl(`/ws/rooms/${encodeURIComponent(slug)}/`));
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
        } else if (data.type === "message" || data.type === "message.update") {
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

  useEffect(() => {
    if (!custom) return;
    let cancelled = false;
    getAccess()
      .then((a) => fetchCustomRoom(slug, a))
      .then((r) => {
        if (cancelled) return;
        setInfo(r);
        // Just created: open the share sheet straight away.
        if (new URLSearchParams(window.location.search).get("share") === "1") {
          setSheet(true);
          window.history.replaceState(null, "", window.location.pathname);
        }
      })
      .catch((e) => {
        if (!cancelled && e instanceof ApiError && e.status === 404) setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [custom, slug, getAccess]);

  const scroll = useStickyScroll(listRef, messages.length);

  const live = useCallback(
    (payload: Record<string, unknown>) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setNotice("You're offline. Reconnecting…");
        return false;
      }
      ws.send(JSON.stringify(payload));
      return true;
    },
    [],
  );
  const onReact = useCallback((id: number, emoji: string | null) => live({ type: "react", message_id: id, emoji }), [live]);
  const onDelete = useCallback((m: Msg) => live({ type: "delete", message_id: m.id }), [live]);
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
    try {
      const page = await fetchHistory(slug, await getAccess(), messages[0].id);
      scroll.hold();
      setMessages((prev) => mergeMessages(page.messages, prev).slice(0, MAX_KEPT));
      setHasMore(page.has_more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - fromBottom;
      });
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't load older messages.");
    }
  }

  function send(text: string): boolean {
    if (status !== "live") return false;
    if (editing) {
      if (!live({ type: "edit", message_id: editing.id, content: text })) return false;
      setEditing(null);
      return true;
    }
    scroll.follow();
    if (!live({ type: "message", content: text, client_id: crypto.randomUUID(), reply_to: replying?.id })) return false;
    setReplying(null);
    return true;
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

  const visible = useMemo(() => messages.filter((m) => !blocked.has(m.sender.id)), [messages, blocked]);
  const items = useMemo<Msg[]>(
    () =>
      visible.map((m) => {
        const rel = relation(m.sender.id);
        return {
          id: m.id,
          mine: rel === "self",
          senderId: m.sender.id,
          senderName: m.sender.nickname,
          senderTag: rel === "friend" ? "friend" : undefined,
          content: m.content,
          attachment: null,
          createdAt: m.created_at,
          replyTo: m.reply_to,
          reactions: m.reactions ?? {},
          edited: m.edited,
          deleted: m.deleted,
        };
      }),
    [visible, relation],
  );
  const byId = useMemo(() => new Map(visible.map((m) => [m.id, m])), [visible]);

  const extraActions = useCallback(
    (msg: Msg): MsgAction[] => {
      const m = byId.get(msg.id);
      if (!m || msg.mine) return [];
      const rel = relation(m.sender.id);
      const out: MsgAction[] = [];
      if (rel === "friend") out.push({ label: `Message ${m.sender.nickname}`, icon: "chat", onClick: () => openChat(m.sender.id) });
      if (rel === "none" || rel === "incoming")
        out.push({
          label: rel === "incoming" ? "Accept friend" : "Add friend",
          icon: "plus",
          onClick: async () => setNotice(await addFriend(m.sender)),
        });
      out.push({ label: "Report…", icon: "shield", onClick: () => setReporting(m) });
      out.push({ label: `Block ${m.sender.nickname}`, icon: "close", danger: true, onClick: () => block(m.sender) });
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- block/report read the latest state when clicked
    [byId, relation, openChat, addFriend],
  );
  // Counts refresh every 30 s; never show fewer than the one person we know is here (you).
  const hereNow = Math.max(presenceCounts?.rooms[slug] ?? 0, status === "live" ? 1 : 0);
  const statusLabel = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", missing: "Room not found" }[
    status
  ];

  return (
    <div className="conversation">
      <ChatHeader
        title={custom ? (info ? `${info.emoji ? `${info.emoji} ` : ""}${info.name}` : "Room") : `# ${room?.name ?? slug}`}
        back="/chat/rooms"
        onTitleClick={custom && info ? () => setSheet(true) : undefined}
        actions={
          custom && info ? (
            <button type="button" className="pill-btn primary room-invite-btn" onClick={() => setSheet(true)} aria-label="Invite and members">
              <Icon name="plus" size={15} /> <span className="hide-phone">Invite</span>
            </button>
          ) : undefined
        }
        subtitle={
          <>
            <span className={`dot ${status === "live" ? "pulse" : "off"}`} /> {statusLabel}
            {status === "live" && hereNow > 0 && <> · {hereNow} here</>}
            {me && <span className="hide-phone"> · you are {me.nickname}</span>}
          </>
        }
      />
      <RoomInfoPanel slug={slug} custom={info} hereNow={hereNow} onInvite={() => setSheet(true)} />

      <div className="messages" ref={listRef} onScroll={scroll.onScroll} aria-live="polite" aria-relevant="additions">
        {hasMore && (
          <button className="load-more" type="button" onClick={loadOlder}>
            Load earlier messages
          </button>
        )}
        {status === "missing" && (
          <p className="empty">
            {custom ? "This room is gone, or you're not in it any more." : "This room doesn't exist."}{" "}
            <Link href="/chat/rooms">Pick another room</Link>.
          </p>
        )}
        {status !== "missing" && visible.length === 0 && (
          <p className="empty">No messages yet. Say hi and get the conversation going.</p>
        )}
        <MessageList
          items={items}
          me={me ?? undefined}
          showNames
          onReact={onReact}
          onReply={onReply}
          onEdit={onEdit}
          onDelete={onDelete}
          extraActions={extraActions}
        />
      </div>
      <JumpToLatest away={scroll.away} unseen={scroll.unseen} onClick={scroll.jump} />

      {reporting && (
        <div className="msg-sheet-veil" onClick={() => setReporting(null)}>
          <div className="link-guard" role="dialog" aria-label={`Report ${reporting.sender.nickname} for`} onClick={(e) => e.stopPropagation()}>
            <p>
              Report <b>{reporting.sender.nickname}</b> for
            </p>
            <div className="report-menu">
              {REPORT_REASONS.map(([reason, label]) => (
                <button key={reason} type="button" onClick={() => report(reporting, reason)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sheet && info && (
        <RoomInfoSheet
          room={info}
          onClose={() => setSheet(false)}
          onChanged={setInfo}
          onGone={() => router.replace("/chat/rooms")}
        />
      )}

      <div className="composer-wrap">
        {notice && (
          <p className="chat-notice" role="alert">
            {notice}
          </p>
        )}
        <Composer
          id="chat-input"
          draftKey={`room:${slug}`}
          placeholder={status === "live" ? "Say something nice…" : "Connecting…"}
          disabled={status !== "live"}
          onSend={send}
          replying={replying}
          replyName={replying ? (replying.mine ? "yourself" : replying.senderName) : undefined}
          onCancelReply={() => setReplying(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
        />
      </div>
    </div>
  );
}
