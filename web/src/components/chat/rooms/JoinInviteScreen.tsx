"use client";

import Link from "next/link";
import { ChatHeader } from "../ChatShell";
import InviteCard from "./InviteCard";

/** /chat/join/<code>: where an invite link lands once you're in vChat. One card, one Join button. */
export default function JoinInviteScreen({ code }: { code: string }) {
  return (
    <div className="page-screen">
      <ChatHeader title="Room invite" back="/chat/rooms" />
      <div className="page-scroll join-invite">
        <p className="muted-text">You&apos;ve been invited to a private room.</p>
        <InviteCard code={code} />
        <Link href="/chat/rooms" className="pill-btn">
          Not now
        </Link>
      </div>
    </div>
  );
}
