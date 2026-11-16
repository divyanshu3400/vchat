"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  deleteRoom,
  fetchRoomMembers,
  inviteLink,
  leaveRoom,
  removeRoomMember,
  updateRoom,
  type ChatUser,
  type CustomRoom,
} from "@/lib/api";
import { useChat } from "../ChatProvider";
import { Avatar, Icon } from "../bits";

type Member = { user: ChatUser; is_owner: boolean };
type Step = "main" | "friends" | "rename" | "delete" | "leave";

/**
 * A custom room's sheet: share the invite link (copy, WhatsApp, the phone's share menu, or straight
 * to a friend), see who's in it, and the owner's controls (rename, new link, remove, delete).
 */
export default function RoomInfoSheet({
  room,
  onClose,
  onChanged,
  onGone,
}: {
  room: CustomRoom;
  onClose: () => void;
  onChanged: (room: CustomRoom) => void;
  onGone: () => void;
}) {
  const { me, getAccess, friends, sendDm } = useChat();
  const [step, setStep] = useState<Step>("main");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(room.name);
  const [sentTo, setSentTo] = useState<Set<number>>(() => new Set());
  const link = room.invite_code ? inviteLink(room.invite_code) : "";
  const shareText = `Join my room "${room.name}" on vChat: ${link}`;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    getAccess()
      .then((a) => fetchRoomMembers(room.slug, a))
      .then((r) => !cancelled && setMembers(r.members))
      .catch(() => !cancelled && setMembers([]));
    return () => {
      cancelled = true;
    };
  }, [room.slug, getAccess]);

  async function run(fn: () => Promise<void>, fail: string) {
    setBusy(true);
    setNote("");
    try {
      await fn();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : fail);
    }
    setBusy(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setNote("Link copied.");
    } catch {
      setNote(link);
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: room.name, text: `Join my room "${room.name}" on vChat`, url: link });
    } catch {
      /* closed the share menu */
    }
  }

  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return createPortal(
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={room.name}>
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet room-sheet">
        <span className="sheet-grab" aria-hidden="true" />
        <div className="room-sheet-head">
          <span className="invite-emoji big" aria-hidden="true">
            {room.emoji || "#"}
          </span>
          <div>
            <h2>{room.name}</h2>
            <p className="muted-text">
              Private room · {members?.length ?? room.members} {(members?.length ?? room.members) === 1 ? "member" : "members"}
              {room.description ? ` · ${room.description}` : ""}
            </p>
          </div>
        </div>

        {step === "main" && (
          <>
            {link && (
              <div className="invite-box">
                <span className="invite-url">{link.replace(/^https?:\/\//, "")}</span>
                <div className="invite-actions">
                  <button type="button" className="pill-btn primary" onClick={copy}>
                    <Icon name="copy" size={15} /> Copy link
                  </button>
                  <a className="pill-btn" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                  {canShare && (
                    <button type="button" className="pill-btn" onClick={nativeShare}>
                      Share…
                    </button>
                  )}
                  {friends.length > 0 && (
                    <button type="button" className="pill-btn" onClick={() => setStep("friends")}>
                      <Icon name="chat" size={15} /> Send to friends
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="list-label">Members</div>
            <div className="room-members">
              {members === null ? (
                <p className="muted-text">Loading…</p>
              ) : (
                members.map((m) => (
                  <div key={m.user.id} className="room-member">
                    <Avatar id={m.user.id} name={m.user.nickname} size={36} />
                    <span className="room-member-name">
                      {m.user.nickname}
                      {m.user.id === me?.id && <span className="tag">You</span>}
                      {m.is_owner && <span className="tag live">Owner</span>}
                    </span>
                    {room.is_owner && !m.is_owner && (
                      <button
                        type="button"
                        className="pill-btn danger-text"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await removeRoomMember(room.slug, m.user.id, await getAccess());
                            setMembers((l) => (l ?? []).filter((x) => x.user.id !== m.user.id));
                            onChanged({ ...room, members: room.members - 1 });
                          }, "Couldn't remove them.")
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="person-small">
              {room.is_owner ? (
                <>
                  <button type="button" className="pill-btn" onClick={() => setStep("rename")}>
                    <Icon name="edit" size={15} /> Rename
                  </button>
                  <button
                    type="button"
                    className="pill-btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        onChanged(await updateRoom(room.slug, { new_link: true }, await getAccess()));
                        setNote("New link made. The old one doesn't work any more.");
                      }, "Couldn't make a new link.")
                    }
                  >
                    New link
                  </button>
                  <button type="button" className="pill-btn danger-text" onClick={() => setStep("delete")}>
                    <Icon name="trash" size={15} /> Delete room
                  </button>
                </>
              ) : (
                <button type="button" className="pill-btn danger-text" onClick={() => setStep("leave")}>
                  <Icon name="exit" size={15} /> Leave room
                </button>
              )}
            </div>
          </>
        )}

        {step === "friends" && (
          <>
            <p className="muted-text">Tap a friend to send them the link.</p>
            <div className="room-members">
              {friends.map((f) => (
                <div key={f.user.id} className="room-member">
                  <Avatar id={f.user.id} name={f.user.nickname} size={36} />
                  <span className="room-member-name">{f.user.nickname}</span>
                  <button
                    type="button"
                    className={`pill-btn${sentTo.has(f.user.id) ? "" : " primary"}`}
                    disabled={sentTo.has(f.user.id)}
                    onClick={() => {
                      // Just the link: in the chat it shows as a card with one Join button.
                      if (sendDm(f.user.id, link)) setSentTo((s) => new Set(s).add(f.user.id));
                      else setNote("You're offline. Try again in a moment.");
                    }}
                  >
                    {sentTo.has(f.user.id) ? "Sent" : "Send"}
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="pill-btn" onClick={() => setStep("main")}>
              Back
            </button>
          </>
        )}

        {step === "rename" && (
          <>
            <label className="ep-field">
              <span>Room name</span>
              <input className="ep-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="ep-buttons">
              <button type="button" className="pill-btn" onClick={() => setStep("main")}>
                Cancel
              </button>
              <button
                type="button"
                className="pill-btn primary"
                disabled={busy || name.trim().length < 2}
                onClick={() =>
                  run(async () => {
                    onChanged(await updateRoom(room.slug, { name: name.trim() }, await getAccess()));
                    setStep("main");
                  }, "Couldn't rename the room.")
                }
              >
                Save
              </button>
            </div>
          </>
        )}

        {(step === "delete" || step === "leave") && (
          <>
            <p>
              {step === "delete"
                ? `Delete "${room.name}"? Its messages go for everyone, and the link stops working.`
                : `Leave "${room.name}"? You can come back with the invite link.`}
            </p>
            <div className="ep-buttons">
              <button type="button" className="pill-btn" onClick={() => setStep("main")}>
                Cancel
              </button>
              <button
                type="button"
                className="pill-btn danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const access = await getAccess();
                    if (step === "delete") await deleteRoom(room.slug, access);
                    else await leaveRoom(room.slug, access);
                    onGone();
                  }, step === "delete" ? "Couldn't delete the room." : "Couldn't leave the room.")
                }
              >
                {step === "delete" ? "Delete" : "Leave"}
              </button>
            </div>
          </>
        )}

        {note && <p className="person-note">{note}</p>}
      </div>
    </div>,
    document.body,
  );
}
