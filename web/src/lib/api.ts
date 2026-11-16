export type ChatUser = {
  id: number;
  nickname: string;
  gender: string;
  is_guest?: boolean;
  /** Yours only: do friends see when you were last online (and you theirs)? */
  show_last_seen?: boolean;
  show_online?: boolean;
  read_receipts?: boolean;
  /** Deactivated or deleted: shown as "vChat user", messages as "********". */
  inactive?: boolean;
  /** Only ever present for yourself. */
  email?: string;
};

/** The message a reply answers, as a short quote. */
export type ReplyPreview = {
  id: number;
  sender_id: number;
  nickname: string;
  text: string;
  kind: AttachmentKind | null;
  deleted: boolean;
};

export type ChatMessage = {
  id: number;
  room: string;
  sender: ChatUser;
  content: string;
  content_type: "text" | "system";
  created_at: string;
  reply_to: ReplyPreview | null;
  /** emoji -> ids of the people who picked it */
  reactions: Record<string, number[]>;
  edited: boolean;
  deleted: boolean;
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

// DRF errors look like {"field": ["msg"]} or {"detail": "msg"}; ours add a machine "code" next to
// "detail". Surface the readable one: "detail" first, never "code".
function firstErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { detail, code: _code, ...rest } = body as Record<string, unknown>;
  void _code;
  if (typeof detail === "string") return detail;
  for (const value of Object.values(rest)) {
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

// --- saved accounts (email + password) ----------------------------------------------

/** Guest -> saved account, step 1: email a code to prove the address. */
export function startAccount(email: string, password: string, access: string) {
  return request<{ sent_to: string }>("/api/auth/account/start", {
    method: "POST",
    access,
    body: JSON.stringify({ email, password }),
  });
}

/** Step 2: the code from the email. The same user, now saved. */
export function verifyAccount(email: string, code: string, access: string) {
  return request<{ user: ChatUser }>("/api/auth/account/verify", {
    method: "POST",
    access,
    body: JSON.stringify({ email, code }),
  });
}

export type GifItem = { id: string; w: number; h: number; title: string };

/** GIFs or stickers from GIPHY through our server: trending without a query. */
export function fetchGifs(kind: "gifs" | "stickers", q: string, offset: number, access: string) {
  const qs = new URLSearchParams({ kind, q, offset: String(offset) });
  return request<{ items: GifItem[]; next: number | null }>(`/api/gifs?${qs}`, { access });
}

/** Mute ("8h" | "1w" | "always" | "off") and/or pin one chat, for you only. */
export function setChatPrefs(userId: number, body: { mute?: string; pin?: boolean }, access: string) {
  return request<ChatPrefs>(`/api/dms/${userId}/prefs`, { method: "POST", access, body: JSON.stringify(body) });
}

export function updateMe(body: { show_last_seen?: boolean; show_online?: boolean; read_receipts?: boolean }, access: string) {
  return request<ChatUser>("/api/auth/me", { method: "PATCH", access, body: JSON.stringify(body) });
}

/** Deactivate (log in to come back) or delete (saved: after 15 days; guests: now). Signs out. */
export function closeAccount(kind: "deactivate" | "delete", body: { password?: string; confirm?: string }, access: string) {
  return request<{ deactivated?: boolean; deleted?: boolean; delete_after?: string }>(`/api/auth/account/${kind}`, {
    method: "POST",
    access,
    body: JSON.stringify(body),
  });
}

export function login(email: string, password: string) {
  return request<Session & { deletion_cancelled?: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function forgotPassword(email: string) {
  return request<{ detail: string }>("/api/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
}

export function resetPassword(email: string, code: string, password: string) {
  return request<Session>("/api/auth/password/reset", {
    method: "POST",
    body: JSON.stringify({ email, code, password }),
  });
}

// --- notifications (Web Push) ----------------------------------------------------------

export type PushPrefs = { messages: boolean; requests: boolean; calls: boolean; preview: boolean; email: boolean };
export type PushInfo = { enabled: boolean; public_key: string; prefs: PushPrefs; devices: number };

export function fetchPush(access: string) {
  return request<PushInfo>("/api/push", { access });
}

export function savePushPrefs(prefs: Partial<PushPrefs>, access: string) {
  return request<{ prefs: PushPrefs }>("/api/push", { method: "PATCH", access, body: JSON.stringify(prefs) });
}

export function pushSubscribe(sub: PushSubscriptionJSON, access: string) {
  return request<null>("/api/push/subscribe", { method: "POST", access, body: JSON.stringify(sub) });
}

export function pushUnsubscribe(endpoint: string, access: string) {
  return request<null>("/api/push/unsubscribe", { method: "POST", access, body: JSON.stringify({ endpoint }) });
}

/** The contact page. `website` is a hidden field only bots fill in. */
export function sendContact(
  input: { topic: string; name: string; email: string; message: string; website: string },
  access?: string,
) {
  return request<{ detail: string }>("/api/contact", { method: "POST", access, body: JSON.stringify(input) });
}

/** The machine-readable reason in an API error, e.g. "account_required". */
export function errorCode(e: unknown): string | undefined {
  if (!(e instanceof ApiError) || !e.body || typeof e.body !== "object") return undefined;
  const code = (e.body as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
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

export function reportUser(
  input: { reported_user: number; message?: number; stranger_session?: string; reason: ReportReason },
  access: string,
) {
  return request<unknown>("/api/reports", { method: "POST", body: JSON.stringify(input), access });
}

// --- friends & DMs ---------------------------------------------------------

/** last_seen: only while offline, and only when both of you show it. */
export type Friend = { user: ChatUser; since: string; online: boolean; last_seen?: string | null };
/** Your own settings for one chat. muted_until null while muted = always. */
export type ChatPrefs = { muted: boolean; muted_until: string | null; pinned: boolean };
export type RoomPresence = { rooms: Record<string, number>; online: number };
export type FriendRequest = { id: number; from_user: ChatUser; to_user: ChatUser; created_at: string };
export type AttachmentKind = "image" | "video" | "audio";
export type Attachment = {
  id: string;
  kind: AttachmentKind;
  mime: string;
  url: string; // signed, expires after a few hours; reload messages for a fresh one. "" for disappearing media.
  width: number | null;
  height: number | null;
  size: number;
  /** Disappearing media: "once" | "10" | "20" | "30" (photos, videos), "twice" (voice). */
  view?: ViewMode;
  views_left?: number;
  opened?: boolean;
};
export type ViewMode = "once" | "10" | "20" | "30" | "twice";
export type DirectMessage = {
  id: number;
  sender: ChatUser;
  recipient_id: number;
  content: string;
  attachment: Attachment | null;
  created_at: string;
  reply_to: ReplyPreview | null;
  /** emoji -> ids of the people who picked it */
  reactions: Record<string, number[]>;
  edited: boolean;
  deleted: boolean;
};

/** Upload with progress (0–1). Resolves to the attachment id to send in a message. */
export function uploadMedia(
  file: Blob,
  kind: AttachmentKind,
  access: string,
  onProgress?: (fraction: number) => void,
  filename = "upload",
  view: ViewMode | "" = "",
): Promise<{ id: string; kind: AttachmentKind }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("kind", kind);
    if (view) form.append("view", view);
    form.append("file", file, filename);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/");
    xhr.setRequestHeader("Authorization", `Bearer ${access}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON (e.g. a proxy error page) */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as { id: string; kind: AttachmentKind });
      else reject(new ApiError(xhr.status, body ?? { detail: xhr.status === 413 ? "That file is too big." : "Upload failed." }));
    };
    xhr.onerror = () => reject(new ApiError(0, { detail: "Upload failed. Check your connection." }));
    xhr.send(form);
  });
}
/** The recipient opens disappearing media: a short-lived link (a photo's works once). */
export function openTimedMedia(id: string, access: string) {
  return request<{ url: string; seconds: number | null; views_left: number }>(`/api/media/${id}/open`, { method: "POST", access });
}

export type ConversationSummary = {
  user: ChatUser;
  last_message: string;
  last_from_me: boolean;
  last_message_at: string;
  unread: number;
} & Partial<ChatPrefs>;

/** Events pushed on the personal socket (/ws/me/). */
export type UserEvent =
  | { type: "ready"; user: ChatUser }
  | { type: "dm"; message: DirectMessage; client_id: string }
  | { type: "dm.update"; message: DirectMessage }
  | { type: "dm.read"; user_id: number; last_id: number }
  | { type: "dm.typing"; user_id: number }
  | { type: "dm.settings"; users: number[]; auto_delete_days: number; by: ChatUser }
  | { type: "conversations.changed" }
  | { type: "media.opened"; attachment_id: string; views_left: number }
  | { type: "friend_request"; request: FriendRequest }
  | { type: "friend_request_removed"; request_id: number }
  | { type: "friend_added"; friend: ChatUser; online?: boolean; request_id: number }
  | { type: "friend_removed"; user_id: number }
  | { type: "presence"; user_id: number; online: boolean; last_seen?: string }
  | { type: "pong" }
  | { type: "error"; code: string; detail: string; client_id: string }
  | { type: "stranger.waiting"; waiting: number }
  | { type: "stranger.matched"; session: string; partner: StrangerPartner; common?: string[] }
  | { type: "stranger.message"; message: StrangerMessage; client_id: string }
  | { type: "stranger.typing" }
  | { type: "stranger.update"; message: StrangerMessage }
  | { type: "watch.state"; chat: WatchChat; state: WatchState | null; server_now: number }
  | { type: "stranger.ended"; by: "you" | "stranger" | "connection"; session: string }
  | { type: "stranger.idle" }
  | { type: "stranger.away"; session: string }
  | { type: "stranger.back"; session: string }
  | { type: "stranger.resumed"; session: string; partner: StrangerPartner; partner_away: boolean; messages: StrangerMessage[] }
  | { type: "call.ringing"; call_id: string }
  | { type: "call.incoming"; call_id: string; kind: CallKind; stranger: boolean; from: ChatUser }
  | { type: "call.accepted"; call_id: string }
  | { type: "call.declined"; call_id: string }
  | { type: "call.taken"; call_id: string }
  | { type: "call.ended"; call_id: string; reason: string }
  | { type: "call.signal"; call_id: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } };

export type CallKind = "voice" | "video";

/** STUN/TURN servers with short-lived TURN credentials, fetched right before each call. */
export function fetchIceServers(access: string) {
  return request<{ ice_servers: RTCIceServer[]; ttl: number; relay: boolean }>("/api/calls/ice", { access });
}

export type StrangerPartner = { id: number; nickname: string; gender: string; region: string };
/** Watching a YouTube video together: one shared state per 1-on-1 chat. */
export type WatchChat = { kind: "dm"; users: number[] } | { kind: "stranger"; session: string };
export type WatchState = {
  video: string;
  playing: boolean;
  /** seconds into the video at server time `at` (ms) */
  position: number;
  at: number;
  by: number;
};

export type StrangerMessage = {
  id: number;
  session: string;
  sender_id: number;
  content: string;
  attachment: Attachment | null;
  created_at: string;
  reply_to: ReplyPreview | null;
  /** emoji -> ids of the people who picked it */
  reactions: Record<string, number[]>;
  edited: boolean;
  deleted: boolean;
};

// --- Plus and rewarded unlocks ------------------------------------------------

export type RewardKind = "gender_filter" | "random_photos";
export type PremiumStatus = {
  plus: boolean;
  plus_until: string | null;
  grants: Record<RewardKind, { uses_left: number; expires_at: string } | null>;
  rewarded_ads: boolean;
  /** Launch phase: every feature is free for everyone, no ads, no prices. */
  free_for_all?: boolean;
};

export function fetchPremiumStatus(access: string) {
  return request<PremiumStatus>("/api/premium/status", { access });
}

/** Call only after a rewarded ad reported it was watched to the end. */
export function claimReward(kind: RewardKind, access: string) {
  return request<{ kind: RewardKind; uses_left: number; expires_at: string; status: PremiumStatus }>(
    "/api/premium/reward",
    { method: "POST", body: JSON.stringify({ kind }), access },
  );
}

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
  return request<{
    partner: ChatUser;
    is_friend: boolean;
    messages: DirectMessage[];
    has_more: boolean;
    partner_read_id: number;
    auto_delete_days: number;
    prefs?: ChatPrefs;
  }>(
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
