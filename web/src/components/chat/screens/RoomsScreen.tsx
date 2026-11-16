"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AdSlot from "@/components/AdSlot";
import RoomClock from "@/components/RoomClock";
import { useRoomPresence } from "@/lib/presence";
import { REGION_ROOMS, TOPIC_ROOMS } from "@/lib/rooms";
import { fetchMyRooms, type CustomRoom } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { Icon } from "../bits";
import CreateRoomSheet from "../rooms/CreateRoomSheet";

const fmt = new Intl.NumberFormat("en-US");

function Here({ n }: { n: number }) {
  return n > 0 ? (
    <span className="here">
      <i className="live-dot" /> {fmt.format(n)}
    </span>
  ) : null;
}

export default function RoomsScreen() {
  const presence = useRoomPresence();
  const here = (slug: string) => presence?.rooms[slug] ?? 0;
  const { me, getAccess, askAccount } = useChat();
  const router = useRouter();
  const [mine, setMine] = useState<CustomRoom[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccess()
      .then(fetchMyRooms)
      .then((r) => !cancelled && setMine(r.rooms))
      .catch(() => !cancelled && setMine([]));
    return () => {
      cancelled = true;
    };
  }, [getAccess]);

  function startCreate() {
    if (me?.is_guest !== false) return askAccount("Save your account to make your own rooms.", () => setCreating(true));
    setCreating(true);
  }

  return (
    <div className="page-screen">
      <ChatHeader title="Rooms" subtitle="Group chats by topic and by where people are" />
      <div className="page-scroll">
        <section aria-labelledby="my-rooms">
          <div className="block-head">
            <h2 id="my-rooms">Your rooms</h2>
            <button type="button" className="pill-btn primary" onClick={startCreate}>
              <Icon name="plus" size={15} /> Create room
            </button>
          </div>
          {mine && mine.length > 0 ? (
            <div className="room-grid">
              {mine.map((r) => (
                <Link key={r.slug} href={`/chat/${r.slug}`} className="room-card custom">
                  <span className="room-card-top">
                    <b>
                      <span className="room-emoji">{r.emoji || "#"}</span> {r.name}
                    </b>
                    <Here n={r.online ?? 0} />
                  </span>
                  <small>
                    {r.is_owner ? "Your room" : "Private room"} · {r.members} {r.members === 1 ? "member" : "members"}
                  </small>
                </Link>
              ))}
            </div>
          ) : (
            mine && <p className="list-empty">Make a private room and share its link with friends. Only people with the link can join.</p>
          )}
        </section>

        <section aria-labelledby="topics">
          <div className="block-head">
            <h2 id="topics">Topics</h2>
          </div>
          <div className="room-grid">
            {TOPIC_ROOMS.map((r) => (
              <Link key={r.slug} href={`/chat/${r.slug}`} className="room-card">
                <span className="room-card-top">
                  <b># {r.name}</b>
                  <Here n={here(r.slug)} />
                </span>
                <small>{r.blurb}</small>
              </Link>
            ))}
          </div>
        </section>

        <AdSlot kind="native" className="rooms-native" />

        <section aria-labelledby="regions">
          <div className="block-head">
            <h2 id="regions">Regions</h2>
          </div>
          <div className="room-grid">
            {REGION_ROOMS.map((r) => (
              <Link key={r.slug} href={`/chat/${r.slug}`} className="room-card region">
                <span className="room-card-top">
                  <b># {r.name}</b>
                  <Here n={here(r.slug)} />
                </span>
                <small>
                  <RoomClock timeZone={r.timezone} className="clock" /> in {r.city}
                </small>
              </Link>
            ))}
          </div>
        </section>
      </div>
      {creating && (
        <CreateRoomSheet
          onClose={() => setCreating(false)}
          onCreated={(room) => {
            setCreating(false);
            router.push(`/chat/${room.slug}?share=1`);
          }}
        />
      )}
    </div>
  );
}
