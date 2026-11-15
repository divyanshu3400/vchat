"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/SiteChrome";
import ThemeToggle from "@/components/ThemeToggle";
import { RoomCount } from "@/components/LiveCounts";
import { REGION_ROOMS, TOPIC_ROOMS } from "@/lib/rooms";
import { useChat } from "./ChatProvider";

export function ChatHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const { setNavOpen, incoming, unread } = useChat();
  const pending = incoming.length + Object.values(unread).reduce((a, b) => a + b, 0);
  return (
    <header className="chat-top">
      <button className="menu-btn" type="button" onClick={() => setNavOpen(true)} aria-label="Open rooms and friends">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        {pending > 0 && <span className="badge">{pending}</span>}
      </button>
      <div className="chat-title">
        <h1>{title}</h1>
        <span className="chat-status" role="status">
          {subtitle}
        </span>
      </div>
      <div className="chat-top-actions">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  );
}

function FriendRequests() {
  const { incoming, outgoing, answerRequest } = useChat();
  const [error, setError] = useState("");
  if (!incoming.length && !outgoing.length) return null;

  const run = (id: number, action: "accept" | "decline" | "cancel") =>
    answerRequest(id, action).catch(() => setError("That request isn't waiting any more."));

  return (
    <section className="side-section" aria-label="Friend requests">
      {incoming.length > 0 && <h2>Friend requests · {incoming.length}</h2>}
      {incoming.map((r) => (
        <div key={r.id} className="req-row">
          <span className="req-name">{r.from_user.nickname}</span>
          <div className="req-actions">
            <button type="button" className="req-accept" onClick={() => run(r.id, "accept")}>
              Accept
            </button>
            <button type="button" onClick={() => run(r.id, "decline")}>
              Decline
            </button>
          </div>
        </div>
      ))}
      {outgoing.length > 0 && <h2>Waiting for answer</h2>}
      {outgoing.map((r) => (
        <div key={r.id} className="req-row muted">
          <span className="req-name">{r.to_user.nickname}</span>
          <div className="req-actions">
            <button type="button" onClick={() => run(r.id, "cancel")}>
              Cancel
            </button>
          </div>
        </div>
      ))}
      {error && <p className="side-error">{error}</p>}
    </section>
  );
}

export default function ChatShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { friends, unread, navOpen, setNavOpen } = useChat();

  const roomLink = (slug: string, name: string) => (
    <Link
      key={slug}
      className="room-link"
      href={`/chat/${slug}`}
      aria-current={pathname === `/chat/${slug}` ? "page" : undefined}
    >
      <span className="friend-name"># {name}</span>
      <RoomCount slug={slug} />
    </Link>
  );
  // Online friends first, then alphabetical.
  const sortedFriends = [...friends].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.user.nickname.localeCompare(b.user.nickname),
  );
  const onlineCount = friends.filter((f) => f.online).length;

  return (
    <div className="chat-shell">
      {navOpen && <div className="side-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside className={`chat-side${navOpen ? " open" : ""}`} aria-label="Rooms and friends">
        <div className="side-head">
          <Logo />
          <button className="side-close" type="button" onClick={() => setNavOpen(false)} aria-label="Close menu">
            ×
          </button>
        </div>

        <FriendRequests />

        <nav className="side-section" aria-label="Friends">
          <h2>
            Friends{friends.length > 0 && ` · ${onlineCount} online`}
          </h2>
          {friends.length === 0 && (
            <p className="side-hint">Liked talking to someone? Tap Add friend on their message.</p>
          )}
          {sortedFriends.map(({ user, online }) => {
            const href = `/chat/dm/${user.id}`;
            return (
              <Link
                key={user.id}
                href={href}
                className={`friend-link${online ? "" : " offline"}`}
                aria-current={pathname === href ? "page" : undefined}
                aria-label={`${user.nickname}, ${online ? "online" : "offline"}${unread[user.id] ? `, ${unread[user.id]} unread` : ""}`}
              >
                <span className="mini-av" aria-hidden="true">
                  {user.nickname[0]?.toUpperCase()}
                  <i className={`presence-dot${online ? " on" : ""}`} />
                </span>
                <span className="friend-name">{user.nickname}</span>
                {unread[user.id] ? <span className="badge">{unread[user.id]}</span> : null}
              </Link>
            );
          })}
        </nav>

        <nav className="side-section" aria-label="Topic rooms">
          <h2>Topics</h2>
          {TOPIC_ROOMS.map((r) => roomLink(r.slug, r.name))}
        </nav>
        <nav className="side-section" aria-label="Region rooms">
          <h2>Regions</h2>
          {REGION_ROOMS.map((r) => roomLink(r.slug, r.name))}
        </nav>
      </aside>
      <div className="chat-main">{children}</div>
    </div>
  );
}
