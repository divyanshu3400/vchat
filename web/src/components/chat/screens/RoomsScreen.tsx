"use client";

import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import RoomClock from "@/components/RoomClock";
import { useRoomPresence } from "@/lib/presence";
import { REGION_ROOMS, TOPIC_ROOMS } from "@/lib/rooms";
import { ChatHeader } from "../ChatShell";

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

  return (
    <div className="page-screen">
      <ChatHeader title="Rooms" subtitle="Group chats by topic and by where people are" />
      <div className="page-scroll">
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
    </div>
  );
}
