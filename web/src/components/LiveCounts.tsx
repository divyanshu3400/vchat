"use client";

import { useRoomPresence } from "@/lib/presence";

const fmt = new Intl.NumberFormat("en-US");

/** "● 1,204 online" for the whole site. Hidden until there is someone to count. */
export function OnlineTotal({ className = "live" }: { className?: string }) {
  const presence = useRoomPresence();
  if (!presence || presence.online < 1) return null;
  return (
    <span className={className}>
      <span className="dot pulse" /> {fmt.format(presence.online)} online
    </span>
  );
}

/** People in one room right now. Renders nothing while empty or unknown. */
export function RoomCount({ slug, suffix = "" }: { slug: string; suffix?: string }) {
  const presence = useRoomPresence();
  const n = presence?.rooms[slug] ?? 0;
  if (n < 1) return null;
  return (
    <span className="room-count">
      <span className="dot" /> {fmt.format(n)}
      {suffix}
    </span>
  );
}
