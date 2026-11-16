"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useId, useMemo, useState } from "react";
import AdSlot from "@/components/AdSlot";
import { ADS_ON, NATIVE_EVERY } from "@/lib/ads";
import type { ChatUser } from "@/lib/api";
import { useRoomPresence } from "@/lib/presence";
import { ALL_ROOMS } from "@/lib/rooms";
import { useChat } from "./ChatProvider";
import { RANDOM_WINDOW, useDock } from "./Dock";
import { useStranger } from "./stranger/StrangerProvider";
import { Avatar, Icon, timeAgo } from "./bits";

type Tab = "all" | "friends" | "rooms" | "unread";
const TABS: [Tab, string][] = [
  ["all", "All"],
  ["friends", "Friends"],
  ["rooms", "Rooms"],
  ["unread", "Unread"],
];

type PersonRow = {
  user: ChatUser;
  friend: boolean;
  online: boolean;
  preview: string;
  at: string | null;
  unread: number;
  /** Position among pinned chats, or -1. */
  pin: number;
  muted: boolean;
};

function FriendRequests() {
  const { incoming, outgoing, answerRequest } = useChat();
  const [error, setError] = useState("");
  if (!incoming.length && !outgoing.length) return null;
  const run = (id: number, action: "accept" | "decline" | "cancel") =>
    answerRequest(id, action).catch(() => setError("That request isn't waiting any more."));

  return (
    <section className="requests" aria-label="Friend requests">
      {incoming.map((r) => (
        <div key={r.id} className="req">
          <Avatar name={r.from_user.nickname} size={36} />
          <div className="req-text">
            <b>{r.from_user.nickname}</b>
            <small>wants to be friends</small>
          </div>
          <button type="button" className="pill-btn primary" onClick={() => run(r.id, "accept")}>
            Accept
          </button>
          <button type="button" className="pill-btn" onClick={() => run(r.id, "decline")} aria-label={`Decline ${r.from_user.nickname}`}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      {outgoing.map((r) => (
        <div key={r.id} className="req muted">
          <Avatar name={r.to_user.nickname} size={36} />
          <div className="req-text">
            <b>{r.to_user.nickname}</b>
            <small>request sent</small>
          </div>
          <button type="button" className="pill-btn" onClick={() => run(r.id, "cancel")}>
            Cancel
          </button>
        </div>
      ))}
      {error && <p className="list-error">{error}</p>}
    </section>
  );
}

export default function ConversationList() {
  const pathname = usePathname();
  const { me, friends, conversations, unread, socketLive } = useChat();
  const { openChat, openRandom, isDesktop, parked } = useDock();
  const stranger = useStranger();
  const nameOf = (id: number) =>
    friends.find((f) => f.user.id === id)?.user.nickname ?? conversations.find((c) => c.user.id === id)?.user.nickname ?? "Chat";
  const lastLine = [...stranger.lines].reverse().find((l) => !l.card);
  const randomPreview =
    stranger.phase === "chatting"
      ? lastLine
        ? `${lastLine.mine ? "You: " : ""}${lastLine.content || (lastLine.attachment ? "📎 Attachment" : "")}`
        : "Chatting anonymously"
      : stranger.phase === "searching"
        ? "Looking for someone…"
        : "Talk to someone new, one-on-one";
  const presence = useRoomPresence();
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const searchId = useId(); // the list is mounted twice on some screens (pane + Chats tab)
  const q = query.trim().toLowerCase();

  // Friends and DM threads merged into one list of people, most recent chat first.
  const people = useMemo<PersonRow[]>(() => {
    const rows = new Map<number, PersonRow>();
    for (const c of conversations) {
      const f = friends.find((x) => x.user.id === c.user.id);
      rows.set(c.user.id, {
        user: c.user,
        friend: !!f,
        online: !!f?.online,
        preview: (c.last_from_me ? "You: " : "") + c.last_message,
        at: c.last_message_at,
        unread: unread[c.user.id] ?? 0,
        pin: c.pinned ? conversations.filter((x) => x.pinned).indexOf(c) : -1,
        muted: !!c.muted,
      });
    }
    for (const f of friends) {
      if (!rows.has(f.user.id)) {
        rows.set(f.user.id, { user: f.user, friend: true, online: f.online, preview: "Say hi 👋", at: null, unread: 0, pin: -1, muted: false });
      }
    }
    return [...rows.values()].sort(
      (a, b) =>
        // Pinned first, in the order they were pinned.
        (a.pin < 0 ? 99 : a.pin) - (b.pin < 0 ? 99 : b.pin) ||
        (b.at ? Date.parse(b.at) : 0) - (a.at ? Date.parse(a.at) : 0) ||
        Number(b.online) - Number(a.online) ||
        a.user.nickname.localeCompare(b.user.nickname),
    );
  }, [conversations, friends, unread]);

  const rooms = useMemo(
    () =>
      [...ALL_ROOMS]
        .map((r) => ({ ...r, here: presence?.rooms[r.slug] ?? 0 }))
        .sort((a, b) => b.here - a.here || a.name.localeCompare(b.name)),
    [presence],
  );

  const shownPeople = people.filter((p) => {
    if (q && !p.user.nickname.toLowerCase().includes(q)) return false;
    if (tab === "friends") return p.friend;
    if (tab === "unread") return p.unread > 0;
    return tab === "all";
  });
  const shownRooms = rooms.filter((r) => !q || r.name.toLowerCase().includes(q));
  const roomsToShow = tab === "rooms" ? shownRooms : tab === "all" ? shownRooms.slice(0, 5) : [];

  function personRow(p: PersonRow) {
    const href = `/chat/dm/${p.user.id}`;
    return (
      <a
        key={p.user.id}
        href={href}
        className={`conv${pathname === href ? " active" : ""}${p.unread ? " has-unread" : ""}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey) return; // let people open a new tab
          e.preventDefault();
          openChat(p.user.id);
        }}
      >
        <Avatar name={p.user.nickname} size={44} online={p.friend ? p.online : undefined} />
        <span className="conv-mid">
          <span className="conv-name">
            {p.user.nickname}
            {!p.friend && <span className="tag">Not friends</span>}
            {p.muted && (
              <span className="conv-flag" title="Muted" aria-label="Muted">
                <Icon name="belloff" size={13} />
              </span>
            )}
          </span>
          <span className="conv-preview">{p.preview}</span>
        </span>
        <span className="conv-meta">
          {p.at && <time dateTime={p.at}>{timeAgo(p.at)}</time>}
          <span className="conv-meta-row">
            {p.pin >= 0 && (
              <span className="conv-flag pin" title="Pinned" aria-label="Pinned">
                <Icon name="pin" size={13} />
              </span>
            )}
            {p.unread > 0 && <span className={`badge${p.muted ? " muted" : ""}`}>{p.unread}</span>}
          </span>
        </span>
      </a>
    );
  }

  return (
    <div className="conv-list">
      <div className="list-head">
        <div className="me-row">
          {me && <Avatar name={me.nickname} size={40} online={socketLive} />}
          <div>
            <b>{me?.nickname ?? "…"}</b>
            <small className={socketLive ? "on" : ""}>{socketLive ? "Online" : "Connecting…"}</small>
          </div>
        </div>
        <label className="search-box">
          <Icon name="search" size={17} />
          <input
            id={searchId}
            type="search"
            placeholder="Search friends and rooms"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="seg" role="tablist" aria-label="Filter conversations">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "on" : ""}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "unread" && Object.keys(unread).length > 0 && <span className="dot-badge" />}
            </button>
          ))}
        </div>
        {parked.length > 0 && (
          <div className="parked" aria-label="Chats moved out of the windows">
            {parked.map((id) =>
              id === RANDOM_WINDOW ? (
                <button key="random" type="button" className="parked-chip" onClick={openRandom} title="Random chat">
                  <span className="parked-orb" aria-hidden="true">
                    <Icon name="shuffle" size={18} />
                  </span>
                </button>
              ) : (
                <button key={id} type="button" className="parked-chip" onClick={() => openChat(id)} title={nameOf(id)}>
                  <Avatar name={nameOf(id)} size={38} />
                  {unread[id] ? <span className="badge">{unread[id]}</span> : null}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <div className="list-scroll">
        {tab === "all" && !q && (
          <Link
            href="/chat/stranger"
            className={`conv conv-random${pathname === "/chat/stranger" ? " active" : ""}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey) return;
              e.preventDefault();
              openRandom();
            }}
          >
            <span className="random-orb" aria-hidden="true">
              <Icon name="shuffle" size={20} />
            </span>
            <span className="conv-mid">
              <span className="conv-name">
                Random chat {stranger.phase === "chatting" && <span className="tag live">Live</span>}
              </span>
              <span className="conv-preview">{randomPreview}</span>
            </span>
          </Link>
        )}
        {tab !== "rooms" && <FriendRequests />}

        {tab !== "rooms" && (
          <>
            {shownPeople.length === 0 && (
              <p className="list-empty">
                {tab === "unread"
                  ? "You're all caught up."
                  : q
                    ? "Nobody by that name."
                    : "No chats yet. Join a room or talk to a stranger, then add the people you like."}
              </p>
            )}
            {shownPeople.map((p, i) => (
              <Fragment key={p.user.id}>
                {personRow(p)}
                {ADS_ON && !isDesktop && (i + 1) % NATIVE_EVERY === 0 && <AdSlot kind="native" className="conv-native" />}
              </Fragment>
            ))}
          </>
        )}

        {roomsToShow.length > 0 && (
          <>
            <div className="list-label">{tab === "rooms" ? "All rooms" : "Popular rooms"}</div>
            {roomsToShow.map((r) => {
              const href = `/chat/${r.slug}`;
              return (
                <Link key={r.slug} href={href} className={`conv conv-room${pathname === href ? " active" : ""}`}>
                  <span className="room-badge" aria-hidden="true">
                    #
                  </span>
                  <span className="conv-mid">
                    <span className="conv-name">{r.name}</span>
                    <span className="conv-preview">{"timezone" in r ? `Region · ${r.city}` : "Topic room"}</span>
                  </span>
                  <span className="conv-meta">
                    {r.here > 0 && (
                      <span className="here">
                        <i className="live-dot" /> {r.here}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
