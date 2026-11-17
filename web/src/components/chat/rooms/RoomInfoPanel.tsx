"use client";

import { useEffect, useState } from "react";
import { fetchRoomMembers, type ChatUser, type CustomRoom } from "@/lib/api";
import { findRoom } from "@/lib/rooms";
import { useChat } from "../ChatProvider";
import { Avatar, Icon } from "../bits";

/**
 * Wide screens: what this room is, on the right of the chat. A room you made or joined shows its
 * members and an invite button; a public room shows what it's for and how many are here.
 */
export default function RoomInfoPanel({ slug, custom, hereNow, onInvite }: { slug: string; custom: CustomRoom | null; hereNow: number; onInvite: () => void }) {
  const { getAccess, me } = useChat();
  const [members, setMembers] = useState<{ user: ChatUser; is_owner: boolean }[] | null>(null);
  const publicRoom = findRoom(slug);

  useEffect(() => {
    if (!custom) return;
    let cancelled = false;
    getAccess()
      .then((a) => fetchRoomMembers(custom.slug, a))
      .then((r) => !cancelled && setMembers(r.members))
      .catch(() => !cancelled && setMembers([]));
    return () => {
      cancelled = true;
    };
  }, [custom, getAccess]);

  if (!custom && !publicRoom) return null;
  const about = custom ? custom.description : "blurb" in (publicRoom ?? {}) ? (publicRoom as { blurb: string }).blurb : publicRoom ? `People in and around ${(publicRoom as { city: string }).city}.` : "";

  return (
    <aside className="info-panel" aria-label="Room info">
      <div className="info-head">Room info</div>
      <div className="info-body">
        <div className="info-who">
          <span className="invite-emoji big" aria-hidden="true">
            {custom ? custom.emoji || "#" : "#"}
          </span>
          <h2>{custom ? custom.name : publicRoom?.name}</h2>
          <span className="muted-text">
            {custom ? `Private room · ${members?.length ?? custom.members} members` : "Public room"}
            {hereNow > 0 ? ` · ${hereNow} here now` : ""}
          </span>
        </div>
        {custom && (
          <button type="button" className="pill-btn primary" onClick={onInvite}>
            <Icon name="plus" size={15} /> Invite people
          </button>
        )}
        {about && (
          <div className="info-section">
            <b>About</b>
            <p>{about}</p>
          </div>
        )}
        {custom && (
          <div className="info-section">
            <b>Members</b>
            <div className="info-members">
              {members === null ? (
                <p>Loading…</p>
              ) : (
                members.map((m) => (
                  <div key={m.user.id} className="room-member">
                    <Avatar id={m.user.id} name={m.user.nickname} size={32} />
                    <span className="room-member-name">
                      {m.user.nickname}
                      {m.user.id === me?.id && <span className="tag">You</span>}
                      {m.is_owner && <span className="tag live">Owner</span>}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        {!custom && (
          <div className="info-section">
            <b>Room rules</b>
            <p>Be kind. No sharing contact details with strangers. 18+ only. Report anyone who makes you uncomfortable.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
