"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdSlot from "@/components/AdSlot";
import { ADS_ON } from "@/lib/ads";
import { ApiError, blockUser, reportUser, uploadMedia, type ReportReason, type ViewMode } from "@/lib/api";
import { useCalls } from "../calls/CallProvider";
import MediaSendSheet from "../media/MediaSendSheet";
import { voiceFilename } from "../media/useRecorder";
import Composer from "../messages/Composer";
import MessageList, { JumpToLatest, type Msg } from "../messages/MessageList";
import { useStickyScroll } from "../messages/useStickyScroll";
import { WatchPanel, WatchStartSheet, useWatch } from "../watch/WatchTogether";
import { useRoomPresence } from "@/lib/presence";
import { findRoom } from "@/lib/rooms";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { Icon } from "../bits";
import UnlockSheet from "../premium/UnlockSheet";
import { INTERESTS, MAX_INTERESTS, interestLabel } from "@/lib/interests";
import { useStranger, type FriendCard, type IceCard } from "../stranger/StrangerProvider";
import { useDock } from "../Dock";
import Dropdown, { DropItem, DropSep } from "../Dropdown";
import { looksLikeContact } from "../messages/richText";
import FadeAway from "../FadeAway";


/** How the other person in a random chat is shown: never their real name. */
const ANON = "Anonymous";

function AnonAvatar({ size }: { size: number }) {
  return (
    <span className="avatar anon-avatar" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="incognito" size={Math.round(size * 0.55)} />
    </span>
  );
}

/** Laptop: random chat in a floating window next to friends' windows. */
export type WinControls = { minimized: boolean; onToggleMin: () => void; onClose: () => void };

function WinButtons({ win }: { win: WinControls }) {
  return (
    <>
      <button type="button" className="icon-btn" aria-label={win.minimized ? "Expand" : "Minimise"} onClick={win.onToggleMin}>
        <Icon name={win.minimized ? "expand" : "min"} size={18} />
      </button>
      <button type="button" className="icon-btn" aria-label="Close" onClick={win.onClose}>
        <Icon name="close" size={18} />
      </button>
    </>
  );
}

const toggleOnHeader = (win: WinControls) => (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest("button, .menu, .dd, a")) win.onToggleMin();
};
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
  // "I want to talk to" (women/men only) and "From" (region) are hidden for now: with more men
  // than women online, filters left people waiting. Everyone is matched with anyone, anywhere.
  const { start, notice, endedBy, interests, toggleInterest } = useStranger();
  const presence = useRoomPresence();

  return (
    <div className="page-scroll center">
      <div className="st-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
        <img src="/brand/logo-mark.png" alt="vChat" className="st-logo" width={96} height={96} />
        <h2>Meet someone new</h2>
        <p className="muted-text">Chat one-on-one, anonymously. Skip anytime, keep the good ones as friends.</p>
        {endedBy === "connection" && <p className="chat-notice">Your connection dropped, so that chat ended.</p>}

        <div className="st-field">
          <span className="st-label">
            Your interests <small className="st-optional">optional · up to {MAX_INTERESTS}</small>
          </span>
          <div className="interest-chips">
            {INTERESTS.map((i) => {
              const on = interests.includes(i.slug);
              const full = !on && interests.length >= MAX_INTERESTS;
              return (
                <button
                  key={i.slug}
                  type="button"
                  className={`interest-chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => toggleInterest(i.slug)}
                >
                  <span aria-hidden="true">{i.emoji}</span> {i.label}
                </button>
              );
            })}
          </div>
          <small className="st-hint">People who like the same things are matched first.</small>
        </div>
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
      <button type="button" className="pill-btn" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}

function ChatView({ win }: { win?: WinControls }) {
  const { me, getAccess, relation, addFriend, answerRequest, premium, setPremium } = useChat();
  const { openChat } = useDock();
  const [contactWarning, setContactWarning] = useState<string | null>(null);
  const warnResolve = useRef<((sent: boolean) => void) | null>(null);
  const { start: startCall } = useCalls();
  const { phase, partner, session, lines, partnerTyping, partnerAway, endedBy, notice, setNotice, next, leave, send, act, typing, shuffleIce } = useStranger();
  const [replying, setReplying] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [unlockPhotos, setUnlockPhotos] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const photosUnlocked = !!premium?.plus || (premium?.grants.random_photos?.uses_left ?? 0) > 0;

  async function sendVoice(blob: Blob, view: ViewMode | "" = "") {
    setNotice("");
    setUploading(0);
    const replyTo = replying?.id;
    setReplying(null);
    try {
      const up = await uploadMedia(blob, "audio", await getAccess(), setUploading, voiceFilename(blob), view);
      if (!send("", up.id, replyTo)) setNotice("You're offline. Reconnecting…");
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Couldn't send the voice message.");
    }
    setUploading(null);
  }

  async function sendPhoto(file: File, view: ViewMode | "" = "", caption = "") {
    setNotice("");
    setUploading(0);
    try {
      const up = await uploadMedia(file, "image", await getAccess(), setUploading, file.name, view);
      if (!send(caption, up.id)) setNotice("You're offline. Reconnecting…");
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
  const ended = phase === "ended";
  const [watchSheet, setWatchSheet] = useState(false);
  const watch = useWatch({ kind: "stranger", session: ended ? null : session });
  const rel = partner ? relation(partner.id) : "none";
  const scroll = useStickyScroll(listRef, lines.length, [partnerTyping, ended, uploading !== null]);

  // Anyone wrote something (not just the system cards): the intro and opener can go.
  const hasText = lines.some((l) => !l.card);
  const items = useMemo<Msg[]>(
    () =>
      lines.map((l) => ({
        card: l.card,
        id: l.id,
        mine: l.mine,
        senderId: l.senderId,
        content: l.content,
        attachment: l.attachment,
        createdAt: l.at,
        replyTo: l.replyTo,
        reactions: l.reactions,
        edited: l.edited,
        deleted: l.deleted,
      })),
    [lines],
  );
  const onReact = useCallback((id: number, emoji: string | null) => act("react", id, emoji), [act]);
  const onDelete = useCallback((m: Msg) => act("delete", m.id), [act]);
  const onReply = useCallback((m: Msg) => {
    setEditing(null);
    setReplying(m);
  }, []);
  const onEdit = useCallback((m: Msg) => {
    setReplying(null);
    setEditing(m);
  }, []);

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

  function submit(text: string, confirmed = false): boolean | Promise<boolean> {
    if (ended) return false;
    // Moving to WhatsApp/Instagram is how most blackmail scams start: ask once before sharing.
    if (!confirmed && !editing && looksLikeContact(text)) {
      return new Promise<boolean>((resolve) => {
        warnResolve.current = resolve;
        setContactWarning(text);
      });
    }
    if (editing) {
      if (!act("edit", editing.id, text)) {
        setNotice("You're offline. Reconnecting…");
        return false;
      }
      setEditing(null);
      return true;
    }
    scroll.follow();
    if (!send(text, undefined, replying?.id)) {
      setNotice("You're offline. Reconnecting…");
      return false;
    }
    setReplying(null);
    return true;
  }

  function answerWarning(send: boolean) {
    const text = contactWarning;
    setContactWarning(null);
    const ok = send && text ? (submit(text, true) as boolean) : false;
    warnResolve.current?.(ok);
    warnResolve.current = null;
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
      setNotice("You blocked them. You'll never be matched again.");
    } catch {
      setNotice("Couldn't block. Try again.");
    }
    if (!ended) leave();
  }

  if (!partner) return null;

  const headActions = (
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
            {rel === "requested" && <span className="tag">Request sent</span>}
            {rel === "friend" && <span className="tag">Friends</span>}
            <Dropdown open={menu !== null} onToggle={() => setMenu(menu ? null : "main")} onClose={() => setMenu(null)} label="Report or block">
              {menu === "report" ? (
                <>
                  <button type="button" className="dd-back" onClick={() => setMenu("main")}>
                    <Icon name="back" size={16} /> Report for…
                  </button>
                  {REPORT_REASONS.map(([reason, label]) => (
                    <DropItem key={reason} icon="flag" tone="amber" onClick={() => report(reason)}>
                      {label}
                    </DropItem>
                  ))}
                </>
              ) : (
                <>
                  {!ended && (
                    <DropItem icon="play" tone="red" hint="Play a video for both of you" onClick={() => { setMenu(null); setWatchSheet(true); }}>
                      Watch YouTube together
                    </DropItem>
                  )}
                  <DropItem icon="flag" tone="amber" hint="Tell us what happened" onClick={() => setMenu("report")}>
                    Report
                  </DropItem>
                  <DropSep />
                  {!ended && (
                    <DropItem icon="exit" tone="muted" onClick={() => { setMenu(null); leave(); }}>
                      Leave chat
                    </DropItem>
                  )}
                  <DropItem icon="ban" tone="danger" onClick={block}>
                    Block
                  </DropItem>
                </>
              )}
            </Dropdown>
          </>
  );
  // Random chat is anonymous: no name, gender or region, only how the chat is going.
  const status = ended
    ? "Chat ended"
    : partnerTyping
      ? "typing…"
      : partnerAway
        ? "Away right now · your messages wait"
        : "Random chat · anonymous";

  return (
    <div className={win ? `win st-win${win.minimized ? " min" : ""}` : "conversation st-chat"}>
      {win ? (
        <header className="win-head" onClick={toggleOnHeader(win)}>
          <AnonAvatar size={34} />
          <div className="win-title">
            <b>{ANON}</b>
            <small className={ended ? "" : "on"}>{status}</small>
          </div>
          {!win.minimized && headActions}
          <WinButtons win={win} />
        </header>
      ) : (
        <ChatHeader
          title={ANON}
          avatar={<AnonAvatar size={36} />}
          subtitle={<span className={ended ? "" : "on"}>{status}</span>}
          actions={headActions}
        />
      )}
      {!win?.minimized && (
      <>
      <WatchPanel watch={watch} partnerName="the stranger" meId={me?.id} />
      {watchSheet && (
        <WatchStartSheet
          onClose={() => setWatchSheet(false)}
          onStart={(video) => {
            setWatchSheet(false);
            if (!watch.start(video)) setNotice("You're offline. Reconnecting…");
          }}
        />
      )}
      <div className="messages" ref={listRef} onScroll={scroll.onScroll} aria-live="polite" aria-relevant="additions">
        {/* The intro and the opener are for an empty chat: they fold away once anyone writes. */}
        <FadeAway key={session ?? "none"} show={!hasText}>
          <p className="sys-line">You&apos;re chatting with someone anonymous. Neither of you can see the other&apos;s name. Say hi!</p>
        </FadeAway>
        {/* Strangers' photos and videos open only if you choose; their links ask first. When the chat
            ends, the messages are gone from the screen (friends keep them in their friend chat). */}
        {!ended && (
        <MessageList
          items={items}
          me={me ?? undefined}
          stranger
          onReact={ended ? () => undefined : onReact}
          onReply={onReply}
          onEdit={ended ? undefined : onEdit}
          onDelete={ended ? undefined : onDelete}
          onWatch={ended ? undefined : (video) => watch.start(video)}
          renderCard={(m) => {
            const any = m.card as FriendCard | IceCard;
            if (any.kind === "ice") {
              return (
                <FadeAway key={`${session}-${m.id}`} show={!hasText}>
                <div className="ice-card">
                  {any.common.length > 0 ? (
                    <span className="ice-common">
                      You both like {any.common.map((c) => interestLabel(c)).join(" · ")}
                    </span>
                  ) : (
                    <span className="ice-common">Say hi! Need an opener?</span>
                  )}
                  <b className="ice-q">“{any.question}”</b>
                  {!ended && (
                    <span className="ice-actions">
                      <button type="button" className="pill-btn primary" onClick={() => submit(any.question)}>
                        Ask this
                      </button>
                      <button type="button" className="pill-btn" onClick={shuffleIce} aria-label="Another question">
                        <Icon name="shuffle" size={14} /> Another
                      </button>
                    </span>
                  )}
                </div>
                </FadeAway>
              );
            }
            const card = any;
            if (card.kind === "sent")
              return (
                <div className="friend-card">
                  <span className="friend-card-icon">🤝</span>
                  <b>You sent a friend request</b>
                  <small>Waiting for them to accept.</small>
                </div>
              );
            if (card.kind === "received")
              return (
                <div className="friend-card incoming">
                  <span className="friend-card-icon">🤝</span>
                  <b>They want to be friends</b>
                  <small>Friends see each other&apos;s names and keep chatting after this chat ends, with photos and calls.</small>
                  <span className="friend-card-actions">
                    <button type="button" className="pill-btn primary" onClick={() => card.requestId && answerRequest(card.requestId, "accept").catch(() => setNotice("That request isn't waiting any more."))}>
                      Accept
                    </button>
                    <button type="button" className="pill-btn" onClick={() => card.requestId && answerRequest(card.requestId, "decline").catch(() => undefined)}>
                      Decline
                    </button>
                  </span>
                </div>
              );
            if (card.kind === "friends")
              return (
                // Good news, said once: it leaves after 3 seconds.
                <FadeAway after={3000}>
                  <div className="friend-card done">
                    <span className="friend-card-icon">🎉</span>
                    <b>You&apos;re friends now</b>
                    <small>You can see each other&apos;s names in Chats, and this chat is saved there.</small>
                  </div>
                </FadeAway>
              );
            return (
              <div className="friend-card muted">
                <b>Friend request declined</b>
              </div>
            );
          }}
        />
        )}
        {uploading !== null && (
          <div className="m me last uploading">
            <div className="m-row">
              <div className="bubble">
                <span className="txt">Sending… {Math.round(uploading * 100)}%</span>
              </div>
            </div>
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
          <div className="ended-card">
            <b>
              {endedBy === "stranger" ? "Stranger left the chat." : endedBy === "connection" ? "Connection lost. The chat ended." : "You left the chat."}
            </b>
            {rel === "friend" ? (
              <>
                <span>You&apos;re friends now, so your chat moved to Chats. It keeps going there.</span>
                <button type="button" className="pill-btn primary" onClick={() => openChat(partner.id)}>
                  Open your chat
                </button>
              </>
            ) : (
              <span>
                The messages are gone. Random chats aren&apos;t saved for you; we keep them 7 days only so reports can be checked.
                {lines.length > 0 && (rel === "none" || rel === "incoming") ? " Liked talking? Add them as a friend to keep chatting." : ""}
              </span>
            )}
          </div>
        )}
      </div>
      <JumpToLatest away={scroll.away} unseen={scroll.unseen} onClick={scroll.jump} />

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
      {contactWarning && (
        <div className="msg-sheet-veil" onClick={() => answerWarning(false)}>
          <div className="link-guard contact-guard" role="alertdialog" aria-label="Sharing contact details" onClick={(e) => e.stopPropagation()}>
            <Icon name="shield" size={22} />
            <p>
              <b className="guard-title">Careful with contact details</b>
              Moving to WhatsApp, Instagram or a phone number is how most blackmail scams start. Strangers can record calls
              and save photos. Share only if you really trust them.
            </p>
            <div>
              <button type="button" onClick={() => answerWarning(false)}>
                Edit
              </button>
              <button type="button" className="go warn" onClick={() => answerWarning(true)}>
                Send anyway
              </button>
            </div>
          </div>
        </div>
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
          <Composer
            id="stranger-input"
            placeholder="Say something nice…"
            onSend={submit}
            onTyping={typing}
            replying={replying}
            replyName={replying ? (replying.mine ? "yourself" : "Stranger") : undefined}
            onCancelReply={() => setReplying(null)}
            editing={editing}
            onCancelEdit={() => setEditing(null)}
            onVoice={sendVoice}
            autoFocusKey={session}
            toolbar={
              <>
                <button type="button" className={`next-btn${escArmed ? " armed" : ""}`} onClick={next} title="Next stranger (Esc twice)">
                  <Icon name="shuffle" size={17} /> {escArmed ? "Esc again" : "Next"}
                </button>
                <button type="button" className="end-btn" onClick={leave} title="End this chat">
                  <Icon name="close" size={17} /> End
                </button>
                <button type="button" className="strip-btn shield-btn" onClick={() => setMenu("report")} title="Report and leave" aria-label="Report and leave">
                  <Icon name="shield" size={17} />
                </button>
                <span className="strip-gap" />
                {(rel === "none" || rel === "incoming") && (
                  <button
                    type="button"
                    className="strip-btn friend-btn"
                    onClick={async () => {
                      const msg = await addFriend(partner);
                      // Sent or accepted shows as a card in the chat; only problems need a notice.
                      if (!/^(Friend request sent|You and .* are now friends)/.test(msg)) setNotice(msg);
                    }}
                    aria-label={rel === "incoming" ? "Accept their friend request" : "Send a friend request"}
                    title={rel === "incoming" ? "Accept friend request" : "Add friend"}
                  >
                    <Icon name="plus" size={17} /> <span className="strip-label">{rel === "incoming" ? "Accept" : "Add"}</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`strip-btn${photosUnlocked ? "" : " locked-media"}`}
                  aria-label={photosUnlocked ? "Send a photo" : "Photos (locked)"}
                  disabled={uploading !== null}
                  onClick={() => (photosUnlocked ? photoRef.current?.click() : setUnlockPhotos(true))}
                >
                  <Icon name={photosUnlocked ? "image" : "lock"} size={17} /> <span className="strip-label">Photo</span>
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
                    if (file) setPicked(file);
                  }}
                />
                {picked && (
                  <MediaSendSheet
                    file={picked}
                    onCancel={() => setPicked(null)}
                    onSend={(view, caption) => {
                      setPicked(null);
                      sendPhoto(picked, view, caption);
                    }}
                  />
                )}
              </>
            }
          />
        )}
      </div>
      </>
      )}
    </div>
  );
}

/** Random chat as a floating window (laptops): start, look, chat and next, all inside it. */
export function StrangerWindow({ win }: { win: WinControls }) {
  const { phase, interstitial, finishInterstitial } = useStranger();
  if (phase === "chatting" || phase === "ended") return <ChatView win={win} />;
  return (
    <div className={`win st-win${win.minimized ? " min" : ""}`}>
      <header className="win-head" onClick={toggleOnHeader(win)}>
        <span className="st-win-orb" aria-hidden="true">
          <Icon name="shuffle" size={18} />
        </span>
        <div className="win-title">
          <b>Random chat</b>
          <small className={phase === "searching" ? "on" : ""}>{phase === "searching" ? "Looking for someone…" : "1-on-1 with someone new"}</small>
        </div>
        <WinButtons win={win} />
      </header>
      {!win.minimized && (phase === "searching" ? <SearchingView /> : <IdleView />)}
      {interstitial && ADS_ON && <Interstitial onDone={finishInterstitial} />}
    </div>
  );
}

export default function StrangerScreen() {
  const { phase, interstitial, finishInterstitial } = useStranger();

  return (
    <div className="page-screen st-screen">
      {phase === "idle" || phase === "searching" ? <ChatHeader title="Random chat" subtitle="1-on-1 with someone new" /> : null}
      {phase === "idle" && <IdleView />}
      {phase === "searching" && <SearchingView />}
      {(phase === "chatting" || phase === "ended") && <ChatView />}
      {interstitial && ADS_ON && <Interstitial onDone={finishInterstitial} />}
    </div>
  );
}
