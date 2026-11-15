"use client";

import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { useRoomPresence } from "@/lib/presence";
import { ChatHeader } from "../ChatShell";
import { Icon } from "../bits";

/** Placeholder until 1-on-1 random chat ships (step 2). Points people at the busiest room meanwhile. */
export default function StrangerScreen() {
  const presence = useRoomPresence();
  const inRandom = presence?.rooms["random"] ?? 0;

  return (
    <div className="page-screen">
      <ChatHeader title="Random chat" subtitle="1-on-1 with a stranger" />
      <div className="page-scroll center">
        <div className="soon">
          <span className="soon-icon">
            <Icon name="shuffle" size={34} />
          </span>
          <h2>One-on-one with strangers is almost here</h2>
          <p>
            Text and voice calls with someone new, skip anytime, and keep the ones you like as friends. Until it opens,
            the Random chat room is the busiest place on vChat.
          </p>
          <Link href="/chat/random" className="start-btn">
            Join # Random chat{inRandom > 0 ? ` · ${inRandom} here` : ""}
          </Link>
        </div>
        <AdSlot kind="rect" className="stranger-rect" />
      </div>
    </div>
  );
}
