"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, fetchInvite, joinInvite, type InvitePreview } from "@/lib/api";
import { useChat } from "../ChatProvider";

// One request per code per page load, however many times the link appears.
const cache = new Map<string, Promise<InvitePreview | null>>();

function preview(code: string, access: string) {
  let p = cache.get(code);
  if (!p) {
    p = fetchInvite(code, access).catch(() => null);
    cache.set(code, p);
  }
  return p;
}

/**
 * A room invite link shared in a chat shows as a card: the room's emoji, name, how many are in
 * it, and one button. Join (or Open, if you're already in).
 */
export default function InviteCard({ code }: { code: string }) {
  const { getAccess } = useChat();
  const router = useRouter();
  const [room, setRoom] = useState<InvitePreview | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getAccess()
      .then((access) => preview(code, access))
      .then((r) => !cancelled && setRoom(r))
      .catch(() => !cancelled && setRoom(null));
    return () => {
      cancelled = true;
    };
  }, [code, getAccess]);

  async function join() {
    if (room?.slug) return router.push(`/chat/${room.slug}`);
    setBusy(true);
    setError("");
    try {
      const joined = await joinInvite(code, await getAccess());
      cache.delete(code);
      router.push(`/chat/${joined.slug}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't join. Try again.");
      setBusy(false);
    }
  }

  if (room === undefined) return <div className="invite-card loading" aria-hidden="true" />;
  if (room === null)
    return (
      <div className="invite-card gone">
        <span className="invite-emoji">🔒</span>
        <span className="invite-text">
          <b>Invite link expired</b>
          <small>Ask for a new link.</small>
        </span>
      </div>
    );

  return (
    <div className="invite-card">
      <span className="invite-emoji" aria-hidden="true">
        {room.emoji || "#"}
      </span>
      <span className="invite-text">
        <b>{room.name}</b>
        <small>
          Room · {room.members} {room.members === 1 ? "member" : "members"}
        </small>
        {error && <small className="ep-error">{error}</small>}
      </span>
      <button type="button" className="pill-btn primary invite-join" disabled={busy} onClick={join}>
        {room.is_member ? "Open" : busy ? "Joining…" : "Join"}
      </button>
    </div>
  );
}
