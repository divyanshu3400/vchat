"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  answerFriendRequest,
  ApiError,
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
  sendDm: (to: number, content: string) => boolean;
  subscribe: (fn: (event: UserEvent) => void) => () => void;
  addFriend: (user: ChatUser) => Promise<string>;
  answerRequest: (id: number, action: "accept" | "decline" | "cancel") => Promise<void>;
  unfriend: (userId: number) => Promise<void>;
  markRead: (userId: number, lastId: number) => void;
  setActiveDm: (userId: number | null) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
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

export default function ChatProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<ChatUser | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [socketLive, setSocketLive] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  const accessRef = useRef<{ token: string; exp: number } | null>(null);
  const inflight = useRef<Promise<string> | null>(null);
  const meRef = useRef<ChatUser | null>(null);
  const activeDm = useRef<number | null>(null);
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
    const [f, r, c] = await Promise.all([fetchFriends(access), fetchFriendRequests(access), fetchConversations(access)]);
    setFriends(f);
    setIncoming(r.incoming);
    setOutgoing(r.outgoing);
    setUnread(Object.fromEntries(c.filter((x) => x.unread > 0 && x.user.id !== activeDm.current).map((x) => [x.user.id, x.unread])));
  }, [getAccess]);

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
        const partner = m.sender.id === self?.id ? m.recipient_id : m.sender.id;
        if (m.sender.id !== self?.id && partner !== activeDm.current) {
          setUnread((u) => ({ ...u, [partner]: (u[partner] ?? 0) + 1 }));
        }
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
      let access: string;
      try {
        access = await getAccess();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return; // redirected to sign-up
        return scheduleRetry();
      }
      if (cancelled) return;
      const ws = new WebSocket(wsUrl("/ws/me/"));
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: access }));
      ws.onmessage = (ev) => {
        const event = JSON.parse(ev.data) as UserEvent;
        if (event.type === "ready") {
          attempt = 0;
          setSocketLive(true);
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
      retry = setTimeout(connect, Math.min(1000 * 2 ** attempt, 15_000));
    }

    connect();
    return () => {
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

  // Close the mobile room list after navigating.
  useEffect(() => {
    const id = setTimeout(() => setNavOpen(false), 0);
    return () => clearTimeout(id);
  }, [pathname]);

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

  const sendDm = useCallback((to: number, content: string) => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "dm", to, content, client_id: crypto.randomUUID() }));
    return true;
  }, []);

  const subscribe = useCallback((fn: (e: UserEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const addFriend = useCallback(
    async (user: ChatUser) => {
      try {
        const res = await sendFriendRequest(user.id, await getAccess());
        if (res.status === "accepted") {
          handleEvent({ type: "friend_added", friend: res.friend, request_id: 0 });
          return `You and ${user.nickname} are now friends.`;
        }
        setOutgoing((l) => [res.request, ...withoutRequest(l, res.request.id)]);
        return `Friend request sent to ${user.nickname}.`;
      } catch (e) {
        return e instanceof ApiError ? e.message : "Couldn't send the request. Try again.";
      }
    },
    [getAccess, handleEvent],
  );

  const answerRequest = useCallback(
    async (id: number, action: "accept" | "decline" | "cancel") => {
      await answerFriendRequest(id, action, await getAccess());
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

  const setActiveDm = useCallback((userId: number | null) => {
    activeDm.current = userId;
  }, []);

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
      subscribe,
      addFriend,
      answerRequest,
      unfriend,
      markRead,
      setActiveDm,
      navOpen,
      setNavOpen,
    }),
    [me, getAccess, friends, incoming, outgoing, unread, socketLive, relation, sendDm, subscribe, addFriend, answerRequest, unfriend, markRead, setActiveDm, navOpen],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
