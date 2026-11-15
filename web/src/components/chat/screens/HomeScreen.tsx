"use client";

import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import RoomClock from "@/components/RoomClock";
import { useRoomPresence } from "@/lib/presence";
import { ALL_ROOMS } from "@/lib/rooms";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { useDock } from "../Dock";
import { Avatar, Icon } from "../bits";

const fmt = new Intl.NumberFormat("en-US");

export default function HomeScreen() {
  const { me, friends } = useChat();
  const { openChat } = useDock();
  const presence = useRoomPresence();
  const online = friends.filter((f) => f.online);
  const rooms = [...ALL_ROOMS]
    .map((r) => ({ ...r, here: presence?.rooms[r.slug] ?? 0 }))
    .sort((a, b) => b.here - a.here)
    .slice(0, 6);

  return (
    <div className="page-screen">
      <ChatHeader title={me ? `Hi, ${me.nickname}` : "vChat"} subtitle={presence && presence.online > 0 ? `${fmt.format(presence.online)} people online` : undefined} />
      <div className="page-scroll">
        <section className="stranger-card" aria-labelledby="stranger-title">
          <div className="stranger-copy">
            <span className="kicker">
              <i className="live-dot" /> 1-on-1 · anonymous
            </span>
            <h2 id="stranger-title">Talk to a stranger</h2>
            <p>Text and voice calls with someone new. Skip anytime, add them as a friend if you click.</p>
            <div className="chips" aria-label="Filters (coming with random chat)">
              <span className="chip">Anyone</span>
              <span className="chip">Any region</span>
              <span className="chip locked">
                <Icon name="lock" size={13} /> Women only
              </span>
            </div>
          </div>
          <Link href="/chat/stranger" className="start-btn">
            <Icon name="shuffle" size={22} /> Start random chat
          </Link>
        </section>

        <AdSlot kind="leader" className="home-leader" />

        <section aria-labelledby="friends-online">
          <div className="block-head">
            <h2 id="friends-online">Friends online</h2>
            <Link href="/chat/inbox" className="see-all">
              All chats
            </Link>
          </div>
          {online.length ? (
            <div className="friend-strip">
              {online.map((f) => (
                <button key={f.user.id} type="button" className="friend-chip" onClick={() => openChat(f.user.id)}>
                  <Avatar name={f.user.nickname} size={54} online />
                  <span>{f.user.nickname}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="soft-empty">
              {friends.length
                ? "None of your friends are online right now."
                : "No friends yet. Meet people in a room or a random chat, then tap Add friend."}
            </p>
          )}
        </section>

        <section aria-labelledby="rooms-now">
          <div className="block-head">
            <h2 id="rooms-now">Busy right now</h2>
            <Link href="/chat/rooms" className="see-all">
              All rooms
            </Link>
          </div>
          <div className="room-grid">
            {rooms.map((r) => (
              <Link key={r.slug} href={`/chat/${r.slug}`} className="room-card">
                <span className="room-card-top">
                  <b># {r.name}</b>
                  {r.here > 0 && (
                    <span className="here">
                      <i className="live-dot" /> {fmt.format(r.here)}
                    </span>
                  )}
                </span>
                <small>
                  {"timezone" in r ? (
                    <>
                      <RoomClock timeZone={r.timezone} /> in {r.city}
                    </>
                  ) : (
                    r.blurb
                  )}
                </small>
              </Link>
            ))}
            <AdSlot kind="native" className="room-native" />
          </div>
        </section>
      </div>
    </div>
  );
}
