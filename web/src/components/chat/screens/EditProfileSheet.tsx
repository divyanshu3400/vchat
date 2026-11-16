"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, checkHandle, setAvatar, updateMe, type ChatUser } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { Avatar, Icon } from "../bits";

const NAME_RE = /^[A-Za-z0-9_.]{3,18}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9_.]{1,18}[a-z0-9_]$/;

type HandleState = { value: string; ok: boolean; note: string };

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

/**
 * Me > Edit profile: photo (friends see it; everyone else sees your initial), display name and
 * @username. The photo saves as soon as it's picked; name and username save with "Save".
 */
export default function EditProfileSheet({ me, onClose }: { me: ChatUser; onClose: () => void }) {
  const { getAccess, replaceMe } = useChat();
  const [name, setName] = useState(me.nickname);
  const [handle, setHandle] = useState(me.handle ?? "");
  const [check, setCheck] = useState<HandleState | null>(null);
  const [error, setError] = useState("");
  const [photoNote, setPhotoNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const guest = me.is_guest !== false;
  const lockedUntil = me.handle && me.handle_next_change ? new Date(me.handle_next_change) : null;
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  const handleChanged = h !== (me.handle ?? "");
  const nameChanged = name.trim() !== me.nickname;
  const nameOk = NAME_RE.test(name.trim());
  const handleFormatOk = !h || HANDLE_RE.test(h);
  const handleOk = !handleChanged || (handleFormatOk && check?.value === h && check.ok);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // Is the username free? Asked 400 ms after typing stops.
  useEffect(() => {
    if (!handleChanged || !h || !HANDLE_RE.test(h)) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await checkHandle(h, await getAccess());
        if (!cancelled) setCheck({ value: h, ok: res.available, note: res.available ? "Available" : res.detail });
      } catch {
        if (!cancelled) setCheck({ value: h, ok: false, note: "Couldn't check right now." });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [h, handleChanged, getAccess]);

  const handleNote = !handleChanged
    ? lockedUntil
      ? `You can change it again on ${lockedUntil.toLocaleDateString(undefined, { day: "numeric", month: "short" })}.`
      : me.handle
        ? "People can find you by it."
        : "Pick one so friends can find you."
    : !h
      ? "A username can be changed, not removed."
      : !handleFormatOk
        ? "3 to 20 letters, numbers, _ or . (not at the start or end)."
        : check?.value === h
          ? check.note
          : "Checking…";

  async function pickPhoto(file: File) {
    if (!file.type.startsWith("image/")) return setPhotoNote("Pick a photo.");
    setPhotoBusy(true);
    setPhotoNote("");
    try {
      replaceMe(await setAvatar(file, await getAccess()));
    } catch (e) {
      setPhotoNote(errorText(e, "Couldn't upload the photo."));
    }
    setPhotoBusy(false);
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      replaceMe(await setAvatar(null, await getAccess()));
    } catch (e) {
      setPhotoNote(errorText(e, "Couldn't remove the photo."));
    }
    setPhotoBusy(false);
  }

  async function save() {
    if (!nameChanged && !handleChanged) return onClose();
    setBusy(true);
    setError("");
    try {
      const body: { nickname?: string; handle?: string } = {};
      if (nameChanged) body.nickname = name.trim();
      if (handleChanged) body.handle = h;
      replaceMe(await updateMe(body, await getAccess()));
      onClose();
    } catch (e) {
      setError(errorText(e, "Couldn't save. Try again."));
    }
    setBusy(false);
  }

  return createPortal(
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label="Edit profile">
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet edit-profile">
        <span className="sheet-grab" aria-hidden="true" />
        <h2>Edit profile</h2>

        <div className="ep-photo">
          <button type="button" className="ep-photo-btn" onClick={() => fileRef.current?.click()} disabled={photoBusy} aria-label="Change photo">
            <Avatar id={me.id} name={me.nickname} size={88} />
            <span className="ep-photo-badge" aria-hidden="true">
              <Icon name={photoBusy ? "timer" : "image"} size={16} />
            </span>
          </button>
          <div>
            <div className="ep-photo-actions">
              <button type="button" className="pill-btn" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                {me.avatar ? "Change photo" : "Add photo"}
              </button>
              {me.avatar && (
                <button type="button" className="pill-btn danger-text" onClick={removePhoto} disabled={photoBusy}>
                  Remove
                </button>
              )}
            </div>
            <small className="muted-text">Only friends see your photo. Random chats and rooms show your initial.</small>
            {photoNote && <small className="ep-error">{photoNote}</small>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pickPhoto(file);
            }}
          />
        </div>

        <label className="ep-field">
          <span>Display name</span>
          <input
            className="ep-input"
            value={name}
            maxLength={18}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!nameOk}
          />
          <small className={nameOk ? "muted-text" : "ep-error"}>
            {nameOk ? "What people see in chats. You can change it 3 times a day." : "3 to 18 letters, numbers, dots or underscores."}
          </small>
        </label>

        <label className="ep-field">
          <span>Username</span>
          {guest ? (
            <small className="muted-text">
              {me.handle ? <b>@{me.handle}</b> : null} {me.handle ? "· " : ""}Save your account (Me → Save my account) to keep it and log in with it.
            </small>
          ) : (
            <>
              <span className="ep-handle">
                <i aria-hidden="true">@</i>
                <input
                  className="ep-input"
                  value={handle}
                  maxLength={21}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={!!lockedUntil}
                  placeholder="yourname"
                  onChange={(e) => setHandle(e.target.value.replace(/\s/g, "").toLowerCase())}
                  aria-invalid={handleChanged && !handleOk}
                />
              </span>
              <small className={!handleChanged || handleOk ? (handleChanged && handleOk ? "ep-ok" : "muted-text") : check?.value === h || !handleFormatOk || !h ? "ep-error" : "muted-text"}>
                {handleNote}
                {handleChanged && handleOk ? " · You can change it again after 14 days." : ""}
              </small>
            </>
          )}
        </label>

        {error && <p className="ep-error">{error}</p>}
        <div className="ep-buttons">
          <button type="button" className="pill-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pill-btn primary" disabled={busy || !nameOk || !handleOk} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
