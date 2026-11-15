export type ChatUser = { id: number; nickname: string; gender: string; is_guest?: boolean };

export type ChatMessage = {
  id: number;
  room: string;
  sender: ChatUser;
  content: string;
  content_type: "text" | "system";
  created_at: string;
};

export type Session = { user: ChatUser; access: string };

export type ReportReason = "spam" | "harassment" | "sexual" | "underage" | "scam" | "other";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(firstErrorMessage(body) ?? `Request failed (${status})`);
  }
}

// DRF errors look like {"field": ["msg"]} or {"detail": "msg"}; surface the first readable one.
function firstErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  for (const value of Object.values(body as Record<string, unknown>)) {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

// Django routes end with "/". Adding it here means a request reaches Django as-is, whether it
// goes through the production nginx or the Next.js dev rewrite, and never gets a redirect.
function withTrailingSlash(path: string) {
  const [route, query] = path.split("?");
  return (route.endsWith("/") ? route : `${route}/`) + (query ? `?${query}` : "");
}

async function request<T>(path: string, init: RequestInit & { access?: string } = {}): Promise<T> {
  const { access, headers, ...rest } = init;
  const res = await fetch(withTrailingSlash(path), {
    ...rest,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
      ...headers,
    },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function guestSignup(input: { nickname: string; gender: string; age_confirmed: boolean }) {
  return request<Session>("/api/auth/guest", { method: "POST", body: JSON.stringify(input) });
}

/** Returns the current session from the httpOnly refresh cookie, or null if there is none. */
export async function refreshSession(): Promise<Session | null> {
  try {
    return await request<Session>("/api/auth/refresh", { method: "POST" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

export function fetchHistory(slug: string, access: string, before?: number) {
  const qs = new URLSearchParams({ limit: "50" });
  if (before) qs.set("before", String(before));
  return request<{ messages: ChatMessage[]; has_more: boolean }>(
    `/api/rooms/${encodeURIComponent(slug)}/messages?${qs}`,
    { access },
  );
}

export function blockUser(userId: number, access: string) {
  return request<null>(`/api/users/${userId}/block`, { method: "POST", access });
}

export function reportUser(input: { reported_user: number; message?: number; reason: ReportReason }, access: string) {
  return request<unknown>("/api/reports", { method: "POST", body: JSON.stringify(input), access });
}

// --- friends & DMs ---------------------------------------------------------

export type Friend = { user: ChatUser; since: string; online: boolean };
export type RoomPresence = { rooms: Record<string, number>; online: number };
export type FriendRequest = { id: number; from_user: ChatUser; to_user: ChatUser; created_at: string };
export type DirectMessage = {
  id: number;
  sender: ChatUser;
  recipient_id: number;
  content: string;
  created_at: string;
};
export type ConversationSummary = {
  user: ChatUser;
  last_message: string;
  last_from_me: boolean;
  last_message_at: string;
  unread: number;
};

/** Events pushed on the personal socket (/ws/me/). */
export type UserEvent =
  | { type: "ready"; user: ChatUser }
  | { type: "dm"; message: DirectMessage; client_id: string }
  | { type: "friend_request"; request: FriendRequest }
  | { type: "friend_request_removed"; request_id: number }
  | { type: "friend_added"; friend: ChatUser; online?: boolean; request_id: number }
  | { type: "friend_removed"; user_id: number }
  | { type: "presence"; user_id: number; online: boolean }
  | { type: "pong" }
  | { type: "error"; code: string; detail: string; client_id: string };

export function fetchFriends(access: string) {
  return request<Friend[]>("/api/friends", { access });
}

export function fetchFriendsOnline(access: string) {
  return request<{ online: number[] }>("/api/friends/online", { access });
}

/** Public: people per room and on the whole site. */
export function fetchRoomPresence() {
  return request<RoomPresence>("/api/rooms/presence");
}

export function fetchFriendRequests(access: string) {
  return request<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }>("/api/friends/requests", { access });
}

export function sendFriendRequest(userId: number, access: string) {
  return request<{ status: "pending"; request: FriendRequest } | { status: "accepted"; friend: ChatUser }>(
    "/api/friends/requests",
    { method: "POST", body: JSON.stringify({ to_user: userId }), access },
  );
}

export function answerFriendRequest(id: number, action: "accept" | "decline" | "cancel", access: string) {
  return request<null>(`/api/friends/requests/${id}/${action}`, { method: "POST", access });
}

export function removeFriend(userId: number, access: string) {
  return request<null>(`/api/friends/${userId}`, { method: "DELETE", access });
}

export function fetchConversations(access: string) {
  return request<ConversationSummary[]>("/api/dms", { access });
}

export function fetchDmHistory(userId: number, access: string, before?: number) {
  const qs = new URLSearchParams({ limit: "50" });
  if (before) qs.set("before", String(before));
  return request<{ partner: ChatUser; is_friend: boolean; messages: DirectMessage[]; has_more: boolean }>(
    `/api/dms/${userId}/messages?${qs}`,
    { access },
  );
}

export function markDmRead(userId: number, lastId: number, access: string) {
  return request<null>(`/api/dms/${userId}/read`, { method: "POST", body: JSON.stringify({ last_id: lastId }), access });
}

/** WebSocket URL for a backend path. In production the socket is on the same host as the page
 * (nginx routes /ws/ to the backend), so nothing is baked into the build. In development set
 * NEXT_PUBLIC_WS_URL to the Django server, because `next dev` doesn't proxy WebSockets. */
export function wsUrl(path: string) {
  const base =
    process.env.NEXT_PUBLIC_WS_URL || `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  return `${base}${path}`;
}
