"use client";

import { useRouter } from "next/navigation";
import { setPlus } from "@/lib/plus";
import AccountSheet from "@/components/account/AccountSheet";
import { markEngaged } from "@/lib/install";
import { usePush } from "@/lib/push";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  answerFriendRequest,
  ApiError,
  errorCode,
  fetchConversations,
  fetchFriendRequests,
  fetchFriends,
  fetchFriendsOnline,
  markDmRead,
  refreshSession,
  removeFriend,
  sendFriendRequest,
  wsUrl,
  type ChatUser,
  type ConversationSummary,
  fetchPremiumStatus,
  type PremiumStatus,
  type Friend,
  type FriendRequest,
  type UserEvent,
} from "@/lib/api";

export type Relation = "self" | "friend" | "requested" | "incoming" | "none";

export const HEARTBEAT_MS = 25_000;
const FRIENDS_ONLINE_POLL_MS = 60_000;

type ChatContextValue = {
  me: ChatUser | null;
  /** A valid access token; refreshes it from the session cookie when it is about to expire. */
  getAccess: () => Promise<string>;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  unread: Record<number, number>;
  socketLive: boolean;
  relation: (userId: number) => Relation;
  sendDm: (to: number, content: string, attachmentId?: string, replyTo?: number) => boolean;
  /** Send any message on the personal socket. False while it is reconnecting. */
  sendRaw: (payload: Record<string, unknown>) => boolean;
  subscribe: (fn: (event: UserEvent) => void) => () => void;
  addFriend: (user: ChatUser) => Promise<string>;
  answerRequest: (id: number, action: "accept" | "decline" | "cancel") => Promise<void>;
  unfriend: (userId: number) => Promise<void>;
  markRead: (userId: number, lastId: number) => void;
  /** While a DM is on screen (a page or an open window), its messages don't count as unread. */
  watchDm: (userId: number) => () => void;
  /** DM threads, most recent first, kept current from live messages. */
  conversations: ConversationSummary[];
  /** Plus and rewarded-ad unlocks. null until loaded. */
  premium: PremiumStatus | null;
  setPremium: (status: PremiumStatus) => void;
  /** Open "Save your account" (email + password). `then` runs once it is saved. */
  askAccount: (reason?: string, then?: () => void) => void;
  /** Notifications on this device (permission, subscription, settings). */
  push: ReturnType<typeof usePush>;
  /** Is this friend's chat on screen right now (a page or an open window)? */
  isWatching: (userId: number) => boolean;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

function jwtExpiry(token: string): number {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part)).exp ?? 0;
  } catch {
    return 0;
  }
}

const withoutRequest = (list: FriendRequest[], id: number) => list.filter((r) => r.id !== id);
const withoutUser = (list: FriendRequest[], userId: number) =>
  list.filter((r) => r.from_user.id !== userId && r.to_user.id !== userId);

/** A few messages sent to friends: a good moment to suggest the app (see lib/install). */
function countSent() {
  try {
    const n = Number(localStorage.getItem("vchat.sent") || 0) + 1;
    localStorage.setItem("vchat.sent", String(n));
    if (n === 5) markEngaged();
  } catch {
    /* private mode */
  }
}

export default function ChatProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<ChatUser | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [premium, setPremiumState] = useState<PremiumStatus | null>(null);
  const [socketLive, setSocketLive] = useState(false);
  // A banned account: the whole chat shows why, and nothing keeps reconnecting.
  const [banned, setBanned] = useState<string | null>(null);

  const setPremium = useCallback((status: PremiumStatus) => {
    setPremiumState(status);
    setPlus(status.plus); // ad slots everywhere hide for Plus
  }, []);

  const accessRef = useRef<{ token: string; exp: number } | null>(null);
  const inflight = useRef<Promise<string> | null>(null);
  const meRef = useRef<ChatUser | null>(null);
  const friendsRef = useRef<Friend[]>([]);
  // How many on-screen views (page or windows) show each DM.
  const watched = useRef(new Map<number, number>());
  const listeners = useRef(new Set<(e: UserEvent) => void>());
  const socket = useRef<WebSocket | null>(null);

  const getAccess = useCallback(async () => {
    const cached = accessRef.current;
    if (cached && cached.exp - Date.now() / 1000 > 60) return cached.token;
    if (!inflight.current) {
      inflight.current = refreshSession()
        .then((session) => {
          if (!session) {
            const room = window.location.pathname.match(/^\/chat\/([\w-]+)$/)?.[1];
            router.replace(room ? `/?room=${room}#join` : "/#join");
            throw new ApiError(401, { detail: "Your session expired." });
          }
          meRef.current = session.user;
          setMe(session.user);
          accessRef.current = { token: session.access, exp: jwtExpiry(session.access) };
          return session.access;
        })
        .finally(() => {
          inflight.current = null;
        });
    }
    return inflight.current;
  }, [router]);

  // Full resync of friends, requests and unread counts: on start and after every reconnect.
  const resync = useCallback(async () => {
    const access = await getAccess();
    const [f, r, c, p] = await Promise.all([
      fetchFriends(access),
      fetchFriendRequests(access),
      fetchConversations(access),
      fetchPremiumStatus(access),
    ]);
    setPremium(p);
    setFriends(f);
    setIncoming(r.incoming);
    setOutgoing(r.outgoing);
    setConversations(c);
    setUnread(
      Object.fromEntries(c.filter((x) => x.unread > 0 && !watched.current.has(x.user.id)).map((x) => [x.user.id, x.unread])),
    );
  }, [getAccess, setPremium]);

  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  const handleEvent = useCallback((event: UserEvent) => {
    const self = meRef.current;
    switch (event.type) {
      case "friend_request": {
        const r = event.request;
        if (r.to_user.id === self?.id) setIncoming((l) => [r, ...withoutRequest(l, r.id)]);
        else setOutgoing((l) => [r, ...withoutRequest(l, r.id)]);
        break;
      }
      case "friend_request_removed":
        setIncoming((l) => withoutRequest(l, event.request_id));
        setOutgoing((l) => withoutRequest(l, event.request_id));
        break;
      case "friend_added":
        markEngaged(); // a good moment to suggest installing the app and notifications
        setFriends((l) => {
          const existing = l.find((f) => f.user.id === event.friend.id);
          if (existing) {
            return event.online === undefined
              ? l
              : l.map((f) => (f === existing ? { ...f, online: event.online === true } : f));
          }
          return [...l, { user: event.friend, since: new Date().toISOString(), online: event.online === true }].sort(
            (a, b) => a.user.nickname.localeCompare(b.user.nickname),
          );
        });
        setIncoming((l) => withoutUser(l, event.friend.id));
        setOutgoing((l) => withoutUser(l, event.friend.id));
        break;
      case "friend_removed":
        setFriends((l) => l.filter((f) => f.user.id !== event.user_id));
        break;
      case "presence":
        setFriends((l) => l.map((f) => (f.user.id === event.user_id ? { ...f, online: event.online } : f)));
        break;
      case "dm": {
        const m = event.message;
        const mine = m.sender.id === self?.id;
        const partner = mine ? m.recipient_id : m.sender.id;
        if (mine) countSent();
        if (!mine && !watched.current.has(partner)) {
          setUnread((u) => ({ ...u, [partner]: (u[partner] ?? 0) + 1 }));
        }
        setConversations((list) => {
          const known = list.find((c) => c.user.id === partner)?.user;
          const partnerUser = mine ? (known ?? friendsRef.current.find((f) => f.user.id === partner)?.user) : m.sender;
          if (!partnerUser) return list; // appears on the next resync
          const summary: ConversationSummary = {
            user: partnerUser,
            last_message: m.content,
            last_from_me: mine,
            last_message_at: m.created_at,
            unread: 0,
          };
          return [summary, ...list.filter((c) => c.user.id !== partner)];
        });
        break;
      }
    }
    listeners.current.forEach((fn) => fn(event));
  }, []);

  // The personal socket: friend events and DMs for this user, with reconnect + resync.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    async function connect() {
      retry = undefined;
      let access: string;
      try {
        access = await getAccess();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // redirected to sign-up
        if (errorCode(e) === "banned") return setBanned(e instanceof ApiError ? e.message : "This account is banned.");
        return scheduleRetry();
      }
      if (cancelled) return;
      const ws = new WebSocket(wsUrl("/ws/me/"));
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: access }));
      ws.onmessage = (ev) => {
        const event = JSON.parse(ev.data) as UserEvent;
        if (event.type === "conversations.changed") resync().catch(() => undefined);
        if (event.type === "error" && event.code === "banned") {
          cancelled = true;
          setBanned(event.detail);
          return;
        }
        if (event.type === "ready") {
          attempt = 0;
          setSocketLive(true);
          // Is this tab on screen? People looking at vChat get no notifications.
          ws.send(JSON.stringify({ type: "visible", visible: document.visibilityState === "visible" }));
          resync().catch(() => undefined);
          // Keeps this tab counted as online (the server forgets silent sockets after ~70 s).
          clearInterval(heartbeat);
          heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
          }, HEARTBEAT_MS);
        }
        handleEvent(event);
      };
      ws.onclose = () => {
        clearInterval(heartbeat);
        if (cancelled || socket.current !== ws) return;
        setSocketLive(false);
        scheduleRetry();
      };
    }

    function scheduleRetry() {
      attempt += 1;
      retry = setTimeout(connect, Math.min(500 * 2 ** attempt, 15_000));
    }

    // Phones pause sockets in the background: on return (or when the network is back),
    // skip the remaining back-off. A socket that is open or still connecting is left alone.
    function wake() {
      if (cancelled || document.visibilityState !== "visible") return;
      const ws = socket.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      if (retry === undefined) return; // a connect() is already in flight
      clearTimeout(retry);
      retry = undefined;
      attempt = 0;
      connect();
    }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    connect();
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      cancelled = true;
      clearTimeout(retry);
      clearInterval(heartbeat);
      socket.current?.close();
      socket.current = null;
    };
  }, [getAccess, resync, handleEvent]);

  // Backstop for presence events lost when a friend's server crashed: re-read who is online.
  useEffect(() => {
    if (!socketLive) return;
    const id = setInterval(async () => {
      try {
        const { online } = await fetchFriendsOnline(await getAccess());
        const ids = new Set(online);
        setFriends((l) =>
          l.some((f) => f.online !== ids.has(f.user.id)) ? l.map((f) => ({ ...f, online: ids.has(f.user.id) })) : l,
        );
      } catch {
        /* next tick */
      }
    }, FRIENDS_ONLINE_POLL_MS);
    return () => clearInterval(id);
  }, [socketLive, getAccess]);

  const relation = useCallback(
    (userId: number): Relation => {
      if (userId === me?.id) return "self";
      if (friends.some((f) => f.user.id === userId)) return "friend";
      if (outgoing.some((r) => r.to_user.id === userId)) return "requested";
      if (incoming.some((r) => r.from_user.id === userId)) return "incoming";
      return "none";
    },
    [me, friends, outgoing, incoming],
  );

  const sendDm = useCallback((to: number, content: string, attachmentId?: string, replyTo?: number) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(
      JSON.stringify({ type: "dm", to, content, attachment: attachmentId, reply_to: replyTo, client_id: crypto.randomUUID() }),
    );
    return true;
  }, []);

  const sendRaw = useCallback((payload: Record<string, unknown>) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  const subscribe = useCallback((fn: (e: UserEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  // Guests save their account (email + password) before making friends.
  type AfterSave = { kind: "add"; user: ChatUser } | { kind: "accept"; id: number } | { kind: "run"; fn: () => void };
  const [accountAsk, setAccountAsk] = useState<{ reason?: string; then?: AfterSave } | null>(null);
  const askAccount = useCallback(
    (reason?: string, then?: () => void) => setAccountAsk({ reason, then: then ? { kind: "run", fn: then } : undefined }),
    [],
  );
  const FRIENDS_REASON = "Save your account to make friends, so you never lose them.";

  const addFriend = useCallback(
    async (user: ChatUser): Promise<string> => {
      // The server says when a guest has to save the account first (account_required).
      try {
        const res = await sendFriendRequest(user.id, await getAccess());
        if (res.status === "accepted") {
          handleEvent({ type: "friend_added", friend: res.friend, request_id: 0 });
          return `You and ${user.nickname} are now friends.`;
        }
        setOutgoing((l) => [res.request, ...withoutRequest(l, res.request.id)]);
        return `Friend request sent to ${user.nickname}.`;
      } catch (e) {
        if (errorCode(e) === "account_required") {
          setAccountAsk({ reason: FRIENDS_REASON, then: { kind: "add", user } });
          return "Save your account to send friend requests.";
        }
        return e instanceof ApiError ? e.message : "Couldn't send the request. Try again.";
      }
    },
    [getAccess, handleEvent],
  );

  const answerRequest = useCallback(
    async (id: number, action: "accept" | "decline" | "cancel") => {
      try {
        await answerFriendRequest(id, action, await getAccess());
      } catch (e) {
        if (errorCode(e) === "account_required") {
          setAccountAsk({ reason: FRIENDS_REASON, then: { kind: "accept", id } });
          return;
        }
        throw e;
      }
      // The socket event updates the lists; remove it now so the UI responds instantly.
      if (action !== "accept") handleEvent({ type: "friend_request_removed", request_id: id });
    },
    [getAccess, handleEvent],
  );

  const unfriend = useCallback(
    async (userId: number) => {
      await removeFriend(userId, await getAccess());
      handleEvent({ type: "friend_removed", user_id: userId });
    },
    [getAccess, handleEvent],
  );

  const markRead = useCallback(
    (userId: number, lastId: number) => {
      setUnread((u) => {
        if (!u[userId]) return u;
        const next = { ...u };
        delete next[userId];
        return next;
      });
      getAccess()
        .then((access) => markDmRead(userId, lastId, access))
        .catch(() => undefined);
    },
    [getAccess],
  );

  const watchDm = useCallback((userId: number) => {
    const map = watched.current;
    map.set(userId, (map.get(userId) ?? 0) + 1);
    setUnread((u) => {
      if (!u[userId]) return u;
      const next = { ...u };
      delete next[userId];
      return next;
    });
    return () => {
      const left = (map.get(userId) ?? 1) - 1;
      if (left > 0) map.set(userId, left);
      else map.delete(userId);
    };
  }, []);

  const push = usePush(getAccess, !!me);
  const isWatching = useCallback((userId: number) => watched.current.has(userId), []);

  // Tell the server when this tab goes on or off screen.
  useEffect(() => {
    const report = () => sendRaw({ type: "visible", visible: document.visibilityState === "visible" });
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [sendRaw]);

  // Unread friend messages: on the app icon (installed app) and in the tab title.
  const unreadTotal = Object.values(unread).reduce((a, b) => a + b, 0);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    (unreadTotal ? nav.setAppBadge?.(unreadTotal) : nav.clearAppBadge?.())?.catch(() => undefined);
    const base = document.title.replace(/^\(\d+\+?\) /, "");
    document.title = unreadTotal ? `(${unreadTotal > 99 ? "99+" : unreadTotal}) ${base}` : base;
  }, [unreadTotal]);

  const value = useMemo<ChatContextValue>(
    () => ({
      me,
      getAccess,
      friends,
      incoming,
      outgoing,
      unread,
      socketLive,
      relation,
      sendDm,
      sendRaw,
      subscribe,
      addFriend,
      answerRequest,
      unfriend,
      markRead,
      watchDm,
      conversations,
      premium,
      setPremium,
      askAccount,
      push,
      isWatching,
    }),
    [me, getAccess, friends, incoming, outgoing, unread, socketLive, relation, sendDm, sendRaw, subscribe, addFriend, answerRequest, unfriend, markRead, watchDm, conversations, premium, setPremium, askAccount, push, isWatching],
  );

  if (banned) {
    return (
      <div className="banned-screen" role="alert">
        <div>
          <h1>Account banned</h1>
          <p>{banned}</p>
          <p>
            <a href="/rules">Chat rules</a> · <a href="/contact">Contact us</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <ChatContext.Provider value={value}>
      {children}
      {accountAsk && (
        <AccountSheet
          reason={accountAsk.reason}
          getAccess={getAccess}
          onClose={() => setAccountAsk(null)}
          onSaved={(user) => {
            const then = accountAsk.then;
            meRef.current = user;
            setMe(user);
            setAccountAsk(null);
            if (then?.kind === "add") void addFriend(then.user);
            else if (then?.kind === "accept") answerRequest(then.id, "accept").catch(() => undefined);
            else if (then?.kind === "run") then.fn();
          }}
        />
      )}
    </ChatContext.Provider>
  );
}
