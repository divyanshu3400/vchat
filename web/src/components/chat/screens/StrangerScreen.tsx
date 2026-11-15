"use client";

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import AdSlot from "@/components/AdSlot";
import { ADS_ON } from "@/lib/ads";
import { ApiError, blockUser, reportUser, uploadMedia, type ReportReason } from "@/lib/api";
import { useCalls } from "../calls/CallProvider";
import MediaBubble from "../media/MediaBubble";
import { useRoomPresence } from "@/lib/presence";
import { REGION_ROOMS, findRoom } from "@/lib/rooms";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { Avatar, Icon } from "../bits";
import UnlockSheet from "../premium/UnlockSheet";
import { useStranger } from "../stranger/StrangerProvider";

const GENDER: Record<string, string> = { M: "Man", F: "Woman", O: "Other" };
const REPORT_REASONS: [ReportReason, string][] = [
  ["sexual", "Sexual content"],
  ["harassment", "Harassment or hate"],
  ["underage", "Looks under 18"],
  ["spam", "Spam or bot"],
  ["scam", "Scam / asking for money"],
];
const TIPS = [
  "Say what you're into in your first message. It gets better replies.",
  "Press Esc twice on a keyboard to skip to the next stranger.",
  "Never share your address, phone number or money details.",
  "Liked them? Tap Add friend to keep chatting later.",
];
const fmt = new Intl.NumberFormat("en-US");

function regionName(slug: string) {
  return slug === "any" ? "Anywhere" : (findRoom(slug)?.name ?? slug);
}

function Interstitial({ onDone }: { onDone: () => void }) {
  const [left, setLeft] = useState(5);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <div className="interstitial" role="dialog" aria-label="Advertisement">
      <div className="interstitial-top">
        <span className="kicker">Ad · between strangers</span>
        <button type="button" className="pill-btn" disabled={left > 0} onClick={onDone}>
          {left > 0 ? `Continue in ${left}` : "Continue"}
        </button>
      </div>
      <AdSlot kind="rect" />
      <p className="muted-text">vChat Plus members never see this.</p>
    </div>
  );
}

function IdleView() {
  const { region, setRegion, want, setWant, start, notice, endedBy } = useStranger();
  const { premium } = useChat();
  const presence = useRoomPresence();
  const [unlockFor, setUnlockFor] = useState<string | null>(null);
  const grant = premium?.grants.gender_filter;
  const unlocked = !!premium?.plus || (grant?.uses_left ?? 0) > 0;

  function pick(g: string) {
    if (g === "any" || unlocked) setWant(g);
    else setUnlockFor(g);
  }

  const option = (g: string, label: string) => (
    <button
      type="button"
      className={`chip${want === g ? " on" : ""}${g !== "any" && !unlocked ? " locked" : ""}`}
      aria-pressed={want === g}
      onClick={() => pick(g)}
    >
      {g !== "any" && !unlocked && <Icon name="lock" size={13} />} {label}
    </button>
  );

  return (
    <div className="page-scroll center">
      <div className="st-start">
        <span className="st-orb" aria-hidden="true">
          <Icon name="shuffle" size={34} />
        </span>
        <h2>Talk to a stranger</h2>
        <p className="muted-text">One-on-one and anonymous. Skip anytime, keep the good ones as friends.</p>
        {endedBy === "connection" && <p className="chat-notice">Your connection dropped, so that chat ended.</p>}

        <div className="st-field">
          <span className="st-label">
            I want to talk to
            {premium?.plus ? (
              <span className="perk">Plus</span>
            ) : grant && grant.uses_left > 0 ? (
              <span className="perk">{grant.uses_left} filtered chats left</span>
            ) : null}
          </span>
          <div className="chips">
            {option("any", "Anyone")}
            {option("F", "Women")}
            {option("M", "Men")}
          </div>
        </div>
        {unlockFor && (
          <UnlockSheet
            kind="gender_filter"
            onClose={() => setUnlockFor(null)}
            onUnlocked={() => {
              setWant(unlockFor);
              setUnlockFor(null);
            }}
          />
        )}
        <label className="st-field" htmlFor="st-region">
          <span className="st-label">From</span>
          <select id="st-region" className="st-select" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="any">Anywhere</option>
            {REGION_ROOMS.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {notice && <p className="chat-notice">{notice}</p>}
        <button type="button" className="start-btn wide" onClick={start}>
          <Icon name="shuffle" size={22} /> Start
        </button>
        <p className="st-rules">
          18+ only. Be kind. Photos and video calls aren&apos;t available with strangers.
          {presence && presence.online > 1 ? ` · ${fmt.format(presence.online)} online now` : ""}
        </p>
      </div>
    </div>
  );
}

function SearchingView() {
  const { waiting, cancel, region, want, notice } = useStranger();
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTip((i) => (i + 1) % TIPS.length), 4500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="page-scroll center">
      <div className="st-searching" role="status">
        <span className="radar" aria-hidden="true">
          <Icon name="shuffle" size={28} />
        </span>
        <h2>
          Finding {want === "F" ? "a woman" : want === "M" ? "a man" : "someone"}
          {region !== "any" ? ` in ${regionName(region)}` : ""}…
        </h2>
        <p className="muted-text">{waiting > 1 ? `${waiting} people are looking right now` : "Hang on, matching usually takes a few seconds"}</p>
        <p className="st-tip">{TIPS[tip]}</p>
        {notice && <p className="chat-notice">{notice}</p>}
      </div>
      <AdSlot kind="rect" className="st-rect" />
      <button type="button" className="pill-btn" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}

function ChatView() {
  const { getAccess, relation, addFriend, premium, setPremium } = useChat();
  const { start: startCall } = useCalls();
  const { phase, partner, session, lines, partnerTyping, endedBy, notice, setNotice, next, leave, send, typing } = useStranger();
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState<number | null>(null);
  const [unlockPhotos, setUnlockPhotos] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const photosUnlocked = !!premium?.plus || (premium?.grants.random_photos?.uses_left ?? 0) > 0;

  async function sendPhoto(file: File) {
    setNotice("");
    setUploading(0);
    try {
      const up = await uploadMedia(file, "image", await getAccess(), setUploading, file.name);
      if (!send("", up.id)) setNotice("You're offline. Reconnecting…");
      else if (premium && !premium.plus && premium.grants.random_photos) {
        // Keep the "photos left" count honest without another request.
        const g = premium.grants.random_photos;
        setPremium({ ...premium, grants: { ...premium.grants, random_photos: g.uses_left > 1 ? { ...g, uses_left: g.uses_left - 1 } : null } });
      }
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't send the photo.");
    }
    setUploading(null);
  }
  const [menu, setMenu] = useState<null | "main" | "report">(null);
  const [escArmed, setEscArmed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ended = phase === "ended";
  const rel = partner ? relation(partner.id) : "none";

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, partnerTyping, ended]);

  useEffect(() => {
    if (!ended) inputRef.current?.focus({ preventScroll: true });
  }, [ended, session]);

  // Esc twice skips (once just arms it), so nobody loses a good chat by a stray key.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (ended || escArmed) {
        setEscArmed(false);
        next();
      } else {
        setEscArmed(true);
        t = setTimeout(() => setEscArmed(false), 2500);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [ended, escArmed, next]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || ended) return;
    if (send(text)) setDraft("");
    else setNotice("You're offline. Reconnecting…");
  }

  async function report(reason: ReportReason) {
    if (!partner || !session) return;
    setMenu(null);
    try {
      await reportUser({ reported_user: partner.id, stranger_session: session, reason }, await getAccess());
      setNotice("Thanks. A moderator will read this chat. You won't be matched with them again.");
      await blockUser(partner.id, await getAccess());
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Couldn't send the report. Try again.");
    }
    if (!ended) leave();
  }

  async function block() {
    if (!partner) return;
    setMenu(null);
    try {
      await blockUser(partner.id, await getAccess());
      setNotice(`You blocked ${partner.nickname}. You'll never be matched again.`);
    } catch {
      setNotice("Couldn't block. Try again.");
    }
    if (!ended) leave();
  }

  if (!partner) return null;
  const sub = [GENDER[partner.gender], regionName(partner.region)].filter(Boolean).join(" · ");

  return (
    <div className="conversation st-chat">
      <ChatHeader
        title={partner.nickname}
        avatar={<Avatar name={partner.nickname} size={38} />}
        subtitle={<span className={ended ? "" : "on"}>{ended ? "Chat ended" : `Stranger · ${sub}`}</span>}
        actions={
          <>
            {!ended && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Ask for a voice call"
                title="Voice call (starts only if they accept)"
                onClick={() => startCall({ id: partner.id, nickname: "Stranger" }, "voice", true)}
              >
                <Icon name="phone" />
              </button>
            )}
            {(rel === "none" || rel === "incoming") && (
              <button type="button" className="pill-btn add-friend" onClick={async () => setNotice(await addFriend(partner))}>
                <Icon name="plus" size={15} /> <span className="hide-phone">Add friend</span>
              </button>
            )}
            {rel === "requested" && <span className="tag">Request sent</span>}
            {rel === "friend" && <span className="tag">Friends</span>}
            <div className="menu-wrap">
              <button type="button" className="icon-btn" aria-label="Report or block" aria-expanded={menu !== null} onClick={() => setMenu(menu ? null : "main")}>
                <Icon name="more" />
              </button>
              {menu === "main" && (
                <div className="menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => setMenu("report")}>
                    Report…
                  </button>
                  <button type="button" role="menuitem" className="danger" onClick={block}>
                    Block
                  </button>
                  {!ended && (
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); leave(); }}>
                      Leave chat
                    </button>
                  )}
                </div>
              )}
              {menu === "report" && (
                <div className="menu" role="menu" aria-label="Report for">
                  {REPORT_REASONS.map(([reason, label]) => (
                    <button key={reason} type="button" role="menuitem" onClick={() => report(reason)}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
      />

      <div className="messages" ref={listRef} aria-live="polite" aria-relevant="additions">
        <p className="sys-line">You&apos;re chatting with a stranger{partner.region !== "any" ? ` from ${regionName(partner.region)}` : ""}. Say hi!</p>
        {lines.map((l) => (
          <div key={l.id} className={`b${l.mine ? " me" : ""}${l.attachment ? " has-media" : ""}`}>
            {/* A stranger's photo stays blurred until you choose to look. */}
            {l.attachment && <MediaBubble attachment={l.attachment} blurUntilTap={!l.mine} />}
            {l.content && <div className="t">{l.content}</div>}
          </div>
        ))}
        {uploading !== null && (
          <div className="b me uploading">
            <div className="t">Sending photo… {Math.round(uploading * 100)}%</div>
          </div>
        )}
        {partnerTyping && !ended && (
          <div className="typing" aria-label="Stranger is typing">
            <i />
            <i />
            <i />
          </div>
        )}
        {ended && (
          <p className="sys-line">
            {endedBy === "stranger" ? "Stranger left the chat." : endedBy === "connection" ? "Connection lost. The chat ended." : "You left the chat."}
          </p>
        )}
      </div>

      {unlockPhotos && (
        <UnlockSheet
          kind="random_photos"
          onClose={() => setUnlockPhotos(false)}
          onUnlocked={() => {
            setUnlockPhotos(false);
            photoRef.current?.click();
          }}
        />
      )}
      <div className="composer-wrap">
        {notice && (
          <p className="chat-notice" role="alert">
            {notice}
          </p>
        )}
        {ended ? (
          <div className="st-endbar">
            <button type="button" className="start-btn" onClick={next}>
              <Icon name="shuffle" size={20} /> Next stranger
            </button>
          </div>
        ) : (
          <form className="composer" onSubmit={submit}>
            <button type="button" className={`next-btn${escArmed ? " armed" : ""}`} onClick={next} title="Next stranger (Esc twice)">
              {escArmed ? "Esc again" : "Next"}
            </button>
            <button
              type="button"
              className={`icon-btn${photosUnlocked ? "" : " locked-media"}`}
              aria-label={photosUnlocked ? "Send a photo" : "Photos (locked)"}
              disabled={uploading !== null}
              onClick={() => (photosUnlocked ? photoRef.current?.click() : setUnlockPhotos(true))}
            >
              <Icon name={photosUnlocked ? "image" : "lock"} size={18} />
            </button>
            <input
              ref={photoRef}
              id="stranger-photo"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) sendPhoto(file);
              }}
            />
            <input
              ref={inputRef}
              id="stranger-input"
              className="composer-input"
              type="text"
              placeholder="Say something nice…"
              maxLength={1000}
              autoComplete="off"
              enterKeyHint="send"
              aria-label="Message the stranger"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value) typing();
              }}
            />
            <button className="send-btn" type="submit" disabled={!draft.trim()} aria-label="Send">
              <Icon name="send" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function StrangerScreen() {
  const { phase, interstitial, finishInterstitial } = useStranger();

  return (
    <div className="page-screen st-screen">
      {phase === "idle" || phase === "searching" ? <ChatHeader title="Random chat" subtitle="1-on-1 with a stranger" /> : null}
      {phase === "idle" && <IdleView />}
      {phase === "searching" && <SearchingView />}
      {(phase === "chatting" || phase === "ended") && <ChatView />}
      {interstitial && ADS_ON && <Interstitial onDone={finishInterstitial} />}
    </div>
  );
}
