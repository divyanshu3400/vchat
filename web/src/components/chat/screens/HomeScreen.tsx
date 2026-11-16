"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import AdSlot from "@/components/AdSlot";
import RoomClock from "@/components/RoomClock";
import { useRoomPresence } from "@/lib/presence";
import { REGION_ROOMS, TOPIC_ROOMS } from "@/lib/rooms";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { useDock } from "../Dock";
import { Avatar, Icon, timeAgo } from "../bits";
import { useStranger } from "../stranger/StrangerProvider";

const fmt = new Intl.NumberFormat("en-US");
const noSubscribe = () => () => undefined;

function deletionCancelled() {
  try {
    return sessionStorage.getItem("vchat.deletionCancelled") === "1";
  } catch {
    return false;
  }
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const HOW = [
  ["shuffle", "Meet someone", "Start a random chat, or join a room by region or topic. No real name, no number."],
  ["smile", "Talk your way", "Reply, react, send voice messages, share a YouTube video and watch it together."],
  ["plus", "Keep the good ones", "Add people as friends. Friends get photos, voice and video calls, and a private chat."],
  ["shield", "Stay in control", "Photos open only if you tap View. Block or report anyone in one tap."],
] as const;

/** The main page: what to do next, at a glance. On laptops the chat windows float over it. */
export default function HomeScreen() {
  const { me, friends, conversations, unread, askAccount } = useChat();
  const { openChat, openRandom } = useDock();
  const stranger = useStranger();
  const presence = useRoomPresence();
  const [q, setQ] = useState("");
  // The visitor's own clock, not the server's.
  const greet = useSyncExternalStore(noSubscribe, greeting, () => "Hi");
  // Logged in during the 15 days after asking for deletion: the deletion was cancelled.
  const comeBack = useSyncExternalStore(noSubscribe, deletionCancelled, () => false);
  const [hideComeBack, setHideComeBack] = useState(false);
  const online = friends.filter((f) => f.online);
  const here = (slug: string) => presence?.rooms[slug] ?? 0;
  const query = q.trim().toLowerCase();
  const match = (name: string, extra = "") => !query || `${name} ${extra}`.toLowerCase().includes(query);
  const topics = TOPIC_ROOMS.filter((r) => match(r.name, r.blurb)).sort((a, b) => here(b.slug) - here(a.slug));
  const regions = REGION_ROOMS.filter((r) => match(r.name, r.city)).sort((a, b) => here(b.slug) - here(a.slug));
  const recent = conversations.slice(0, 4);
  const randomBusy = stranger.phase === "chatting" || stranger.phase === "searching";

  function startRandom() {
    if (!randomBusy) stranger.start();
    openRandom();
  }

  return (
    <div className="page-screen home2">
      <ChatHeader
        title={me ? `${greet}, ${me.nickname}` : "vChat"}
        subtitle={presence && presence.online > 0 ? `${fmt.format(presence.online)} people online now` : "Welcome to vChat"}
      />
      <div className="page-scroll">
        <div className="home-wrap">
          {comeBack && !hideComeBack && (
            <section className="home-banner welcome-back" role="status">
              <Icon name="check" size={20} />
              <p>
                <b>Welcome back{me ? `, ${me.nickname}` : ""}!</b> Your account deletion was cancelled. Everything is just as you
                left it.
              </p>
              <button
                type="button"
                className="pill-btn"
                onClick={() => {
                  try {
                    sessionStorage.removeItem("vchat.deletionCancelled");
                  } catch {
                    /* nothing to clear */
                  }
                  setHideComeBack(true);
                }}
              >
                OK
              </button>
            </section>
          )}

          {me?.is_guest !== false && me && (
            <section className="home-banner" aria-label="Save your account">
              <Icon name="lock" size={20} />
              <p>
                <b>You&apos;re a guest on this browser.</b> Save your account with an email so you never lose your friends,
                and log in on any device.
              </p>
              <button type="button" className="pill-btn" onClick={() => askAccount()}>
                Save my account
              </button>
            </section>
          )}

          <label className="home-search">
            <Icon name="search" size={18} />
            <input type="search" placeholder="Search rooms by name, city or topic" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>

          <section className="home-random" aria-labelledby="home-random-title">
            <div className="home-random-art" aria-hidden="true">
              <span className="b1">hey 👋</span>
              <span className="b2">from Lisbon!</span>
              <span className="b3">add me? ✨</span>
            </div>
            <div className="home-random-copy">
              <span className="kicker">
                <i className="live-dot" /> {presence && presence.online > 1 ? `${fmt.format(presence.online)} online` : "1-on-1 · anonymous"}
              </span>
              <h2 id="home-random-title">Random chat</h2>
              <p>
                We&apos;ll connect you with a random stranger. Skip anytime, keep the good ones as friends. Don&apos;t share personal
                details with people you just met.
              </p>
              <div className="home-random-actions">
                <button type="button" className="start-btn" onClick={startRandom}>
                  <Icon name="shuffle" size={20} />
                  {stranger.phase === "chatting" ? "Back to your chat" : stranger.phase === "searching" ? "Looking…" : "Start chat"}
                </button>
                <Link href="/chat/stranger" className="pill-btn">
                  Filters
                </Link>
              </div>
            </div>
          </section>

          {(online.length > 0 || recent.length > 0) && (
            <div className="home-two">
              {online.length > 0 && (
                <section aria-labelledby="home-online">
                  <div className="block-head">
                    <h2 id="home-online">Friends online</h2>
                  </div>
                  <div className="friend-strip">
                    {online.map((f) => (
                      <button key={f.user.id} type="button" className="friend-chip" onClick={() => openChat(f.user.id)}>
                        <Avatar name={f.user.nickname} size={50} online />
                        <span>{f.user.nickname}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {recent.length > 0 && (
                <section aria-labelledby="home-recent">
                  <div className="block-head">
                    <h2 id="home-recent">Recent chats</h2>
                    <Link href="/chat/inbox" className="see-all">
                      All chats
                    </Link>
                  </div>
                  <div className="home-recent">
                    {recent.map((c) => (
                      <button key={c.user.id} type="button" className="home-recent-row" onClick={() => openChat(c.user.id)}>
                        <Avatar name={c.user.nickname} size={38} />
                        <span>
                          <b>{c.user.nickname}</b>
                          <small>
                            {c.last_from_me ? "You: " : ""}
                            {c.last_message}
                          </small>
                        </span>
                        <span className="home-recent-meta">
                          <time dateTime={c.last_message_at}>{timeAgo(c.last_message_at)}</time>
                          {unread[c.user.id] ? <span className="badge">{unread[c.user.id]}</span> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          <AdSlot kind="leader" className="home-leader" />

          <section aria-labelledby="home-topics">
            <div className="block-head">
              <h2 id="home-topics">Topic rooms</h2>
              <Link href="/chat/rooms" className="see-all">
                All rooms
              </Link>
            </div>
            {topics.length ? (
              <div className="room-grid">
                {topics.map((r) => (
                  <Link key={r.slug} href={`/chat/${r.slug}`} className="room-card">
                    <span className="room-card-top">
                      <b># {r.name}</b>
                      <span className="here">
                        <i className={here(r.slug) > 0 ? "live-dot" : "idle-dot"} /> {fmt.format(here(r.slug))}
                      </span>
                    </span>
                    <small>{r.blurb}</small>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="soft-empty">No topic room matches “{q}”.</p>
            )}
          </section>

          <section aria-labelledby="home-regions">
            <div className="block-head">
              <h2 id="home-regions">Rooms by region</h2>
            </div>
            {regions.length ? (
              <div className="room-grid">
                {regions.map((r) => (
                  <Link key={r.slug} href={`/chat/${r.slug}`} className="room-card">
                    <span className="room-card-top">
                      <b>{r.name}</b>
                      <span className="here">
                        <i className={here(r.slug) > 0 ? "live-dot" : "idle-dot"} /> {fmt.format(here(r.slug))}
                      </span>
                    </span>
                    <small>
                      <RoomClock timeZone={r.timezone} /> in {r.city}
                    </small>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="soft-empty">No region room matches “{q}”.</p>
            )}
          </section>

          <section className="home-how" aria-labelledby="home-how-title">
            <h2 id="home-how-title">How vChat works</h2>
            <ol>
              {HOW.map(([icon, title, text], i) => (
                <li key={title}>
                  <span className="how-num" aria-hidden="true">
                    <Icon name={icon} size={20} />
                    <b>{i + 1}</b>
                  </span>
                  <span>
                    <b>{title}</b>
                    <small>{text}</small>
                  </span>
                </li>
              ))}
            </ol>
            <p className="home-how-foot">
              <Link href="/rules">Chat rules</Link> · <Link href="/report">Report abuse</Link> · <Link href="/chat/me">Install the app</Link>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
