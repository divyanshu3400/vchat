"use client";

import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { gifFull, gifLabel, gifSmall, parseGif, type GifRef } from "@/lib/gifs";
import type { Attachment, ReplyPreview } from "@/lib/api";
import MediaBubble from "../media/MediaBubble";
import { Icon } from "../bits";
import EmojiPicker, { rememberEmoji } from "./EmojiPicker";
import { cleanWordsOn, firstYoutube, isJumboEmoji, looksLikeContact, mentions, moodOf, renderRich, type Mood } from "./richText";
import { inviteCodeIn } from "@/lib/api";
import InviteCard from "../rooms/InviteCard";

/** One message, whichever chat it came from (room, friend or random). */
export type Msg = {
  /** Not a message: something that happened (a friend request…), drawn by `renderCard`. */
  card?: unknown;
  id: number;
  mine: boolean;
  senderId: number;
  senderName?: string;
  senderTag?: string;
  content: string;
  attachment: Attachment | null;
  createdAt: string;
  replyTo: ReplyPreview | null;
  reactions: Record<string, number[]>;
  edited: boolean;
  deleted: boolean;
  /** Your own messages: "seen" once the other person read it (friend chats). */
  status?: "sent" | "seen";
  /** Not confirmed by the server yet (see ChatProvider's outbox). */
  pending?: { state: "sending" | "queued" | "failed"; error?: string; key: string };
};

export type MsgAction = { label: string; icon?: string; onClick: () => void; danger?: boolean };

export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👍"];
const EDIT_MS = 15 * 60 * 1000;
const DELETE_MS = 60 * 60 * 1000;
const GROUP_GAP_MS = 5 * 60 * 1000;
const LONG_PRESS_MS = 420;
const SWIPE_REPLY_PX = 56;

type Props = {
  items: Msg[];
  me?: { id: number; nickname: string };
  /** Rooms: names above other people's messages. */
  showNames?: boolean;
  /** Random chat: strangers' photos blurred, links confirmed before opening. */
  stranger?: boolean;
  onReact: (id: number, emoji: string | null) => void;
  onReply: (m: Msg) => void;
  onEdit?: (m: Msg) => void;
  onDelete?: (m: Msg) => void;
  extraActions?: (m: Msg) => MsgAction[];
  /** 1-on-1 chats: play a shared YouTube link for both people. */
  onWatch?: (video: string) => void;
  /** Draws the cards among the messages (see Msg.card). */
  renderCard?: (m: Msg) => React.ReactNode;
  /** Your messages that didn't send: try again, or drop them. */
  onRetry?: (m: Msg) => void;
  onDiscard?: (m: Msg) => void;
  /** "N new messages" goes above this message (unread when the chat was opened). */
  newFrom?: { id: number; count: number } | null;
};

const dayKey = (iso: string) => new Date(iso).toDateString();
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function myReaction(m: Msg, meId: number | undefined): string | null {
  if (meId === undefined) return null;
  for (const [emoji, ids] of Object.entries(m.reactions)) if (ids.includes(meId)) return emoji;
  return null;
}

// --- little celebrations for new warm messages ----------------------------------------------

const BURST: Record<Mood, string[]> = {
  love: ["❤️", "💕", "💖", "😍", "💗"],
  party: ["🎉", "🎊", "✨", "🥳", "🎈"],
  cheer: ["✨", "⭐", "👏", "🌟"],
};

function burst(from: Element, mood: Mood) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = from.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "burst-layer";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
  const pool = BURST[mood];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.textContent = pool[i % pool.length];
    s.style.left = `${8 + Math.random() * 84}%`;
    s.style.animationDelay = `${Math.random() * 0.5}s`;
    s.style.fontSize = `${18 + Math.random() * 16}px`;
    s.style.setProperty("--drift", `${(Math.random() - 0.5) * 80}px`);
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2600);
}

// --- a GIF or sticker -------------------------------------------------------------------------

function GifBubble({ gif }: { gif: GifRef }) {
  const [big, setBig] = useState(false);
  return (
    <>
      <button type="button" className="gif-msg" style={{ aspectRatio: `${gif.w} / ${gif.h}` }} onClick={() => setBig(true)} aria-label="GIF. Tap to enlarge.">
        {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY's CDN */}
        <img src={gifSmall(gif.id)} alt="GIF" loading="lazy" referrerPolicy="no-referrer" draggable={false} />
        <span className="gif-badge" aria-hidden="true">GIF</span>
      </button>
      {big &&
        createPortal(
          <div className="lightbox" role="dialog" aria-label="GIF" onClick={() => setBig(false)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY's CDN */}
            <img src={gifFull(gif.id)} alt="GIF" referrerPolicy="no-referrer" />
          </div>,
          document.body,
        )}
    </>
  );
}

// --- one bubble ---------------------------------------------------------------------------------

type BubbleProps = {
  m: Msg;
  first: boolean;
  last: boolean;
  meId?: number;
  meNick?: string;
  showNames?: boolean;
  stranger?: boolean;
  onMenu: (m: Msg, el: HTMLElement) => void;
  onReact: (id: number, emoji: string | null) => void;
  onReply: (m: Msg) => void;
  onLink: (url: string) => void;
  onWatch?: (video: string) => void;
  onRetry?: (m: Msg) => void;
  onDiscard?: (m: Msg) => void;
};

const Bubble = memo(function Bubble({ m, first, last, meId, meNick, showNames, stranger, onMenu, onReact, onReply, onLink, onWatch, onRetry, onDiscard }: BubbleProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout> | undefined; swiping: boolean; dx: number } | null>(null);
  const lastTap = useRef(0);
  const [clean] = useState(cleanWordsOn);

  const mine = m.mine;
  // Deleted, or not sent yet: nothing to react to, reply to or open a menu on.
  const frozen = m.deleted || !!m.pending;
  const gif = !m.deleted ? parseGif(m.content) : null;
  const jumbo = !gif && !m.deleted && !m.attachment && !m.replyTo && isJumboEmoji(m.content);
  const yt = !gif && !m.deleted && m.content ? firstYoutube(m.content) : null;
  // A room invite link becomes a Join card; a message that is only the link shows just the card.
  const invite = !gif && !m.deleted && m.content ? inviteCodeIn(m.content) : null;
  const onlyInvite = !!invite && /^\S+$/.test(m.content.trim());
  const mentioned = !mine && !!meNick && mentions(m.content, meNick);
  const mineEmoji = myReaction(m, meId);
  const reactions = Object.entries(m.reactions).sort((a, b) => b[1].length - a[1].length);

  function toggleHeart() {
    if (frozen) return;
    onReact(m.id, mineEmoji === "❤️" ? null : "❤️");
    navigator.vibrate?.(8);
  }

  // Swipe towards the middle to reply: right on their messages, left on yours.
  const dir = mine ? -1 : 1;

  function setShift(dx: number) {
    const el = rowRef.current;
    if (!el) return;
    el.style.transform = dx ? `translateX(${dx * dir}px)` : "";
    el.style.setProperty("--swipe", String(Math.min(1, dx / SWIPE_REPLY_PX)));
  }

  function jumpTo(id: number) {
    const list = rowRef.current?.closest(".messages");
    const target = list?.querySelector<HTMLElement>(`[data-mid="${id}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.remove("flash");
    void target.offsetWidth;
    target.classList.add("flash");
  }

  return (
    <div
      className={`m${mine ? " me" : ""}${first ? " first" : ""}${last ? " last" : ""}${mentioned ? " mentioned" : ""}${m.pending ? ` pending ${m.pending.state}` : ""}`}
      data-mid={m.id}
    >
      {showNames && !mine && first && (
        <span className="who">
          {m.senderName}
          {m.senderTag && <small>{m.senderTag}</small>}
        </span>
      )}
      <div
        className="m-row"
        ref={rowRef}
        onContextMenu={(e) => {
          if (frozen) return;
          e.preventDefault();
          onMenu(m, e.currentTarget);
        }}
        onDoubleClick={() => Date.now() - lastTap.current > 700 && toggleHeart()}
        onTouchStart={(e) => {
          const t = e.touches[0];
          const el = e.currentTarget;
          press.current = {
            x: t.clientX,
            y: t.clientY,
            swiping: false,
            dx: 0,
            t: setTimeout(() => {
              if (!frozen && press.current && !press.current.swiping) {
                navigator.vibrate?.(12);
                onMenu(m, el);
                press.current = null;
              }
            }, LONG_PRESS_MS),
          };
        }}
        onTouchMove={(e) => {
          const p = press.current;
          if (!p) return;
          const t = e.touches[0];
          const dx = (t.clientX - p.x) * dir;
          const dy = t.clientY - p.y;
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(p.t);
          if (!p.swiping && dx > 12 && Math.abs(dy) < 24 && !frozen) p.swiping = true;
          if (p.swiping) {
            p.dx = Math.max(0, Math.min(dx, 90));
            setShift(p.dx);
          }
        }}
        onTouchEnd={() => {
          const p = press.current;
          press.current = null;
          if (!p) return;
          clearTimeout(p.t);
          if (p.swiping) {
            setShift(0);
            if (p.dx >= SWIPE_REPLY_PX) {
              navigator.vibrate?.(10);
              onReply(m);
            }
            return;
          }
          const now = Date.now();
          if (now - lastTap.current < 320) {
            lastTap.current = now;
            toggleHeart();
          } else {
            lastTap.current = now;
          }
        }}
        onTouchCancel={() => {
          if (press.current) clearTimeout(press.current.t);
          press.current = null;
          setShift(0);
        }}
      >
        <span className="swipe-hint" aria-hidden="true">
          <Icon name="reply" size={16} />
        </span>
        <div
          className={`bubble${jumbo ? " jumbo" : ""}${(m.attachment || gif) && !m.deleted ? " has-media" : ""}${m.deleted ? " deleted" : ""}${
            m.attachment?.kind === "audio" ? " voice" : ""
          }`}
        >
          {m.replyTo && (
            <button type="button" className="quote" onClick={() => jumpTo(m.replyTo!.id)}>
              <b>{m.replyTo.sender_id === meId ? "You" : m.replyTo.nickname}</b>
              <span>{m.replyTo.deleted ? "Deleted message" : gifLabel(m.replyTo.text) || "Message"}</span>
            </button>
          )}
          {m.deleted ? (
            <span className="txt">
              <Icon name="trash" size={14} /> {mine ? "You deleted this message" : "This message was deleted"}
            </span>
          ) : (
            <>
              {m.attachment && <MediaBubble attachment={m.attachment} ask={!mine} />}
              {gif && <GifBubble gif={gif} />}
              {invite && <InviteCard code={invite} />}
              {m.content && !gif && !onlyInvite && (
                <span className="txt">{renderRich(m.content, { me: meNick, clean, onLink: stranger && !mine ? onLink : undefined })}</span>
              )}
              {yt && (
                <a
                  className="yt-card"
                  href={yt.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  onClick={(e) => {
                    if (stranger && !mine) {
                      e.preventDefault();
                      onLink(yt.url);
                    }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- YouTube's own thumbnail */}
                  <img src={`https://i.ytimg.com/vi/${yt.id}/mqdefault.jpg`} alt="" loading="lazy" />
                  <span>
                    <Icon name="play" size={14} /> YouTube
                  </span>
                </a>
              )}
              {yt && onWatch && (
                <button type="button" className="yt-together" onClick={() => onWatch(yt.id)}>
                  <Icon name="play" size={14} /> Watch together
                </button>
              )}
            </>
          )}
          <span className="meta">
            {m.edited && <em>edited</em>}
            {timeLabel(m.createdAt)}
            {m.pending && (
              <i className="tick wait" aria-label={m.pending.state === "failed" ? "Not sent" : m.pending.state === "queued" ? "Waiting for connection" : "Sending"}>
                <Icon name={m.pending.state === "failed" ? "close" : "timer"} size={13} />
              </i>
            )}
            {mine && m.status && !m.deleted && !m.pending && (
              <i className={`tick${m.status === "seen" ? " seen" : ""}`} aria-label={m.status === "seen" ? "Seen" : "Sent"}>
                <Icon name={m.status === "seen" ? "checks" : "check"} size={14} />
              </i>
            )}
          </span>
        </div>
        {!frozen && (
          <div className="m-tools">
            <button type="button" aria-label="React" onClick={(e) => onMenu(m, e.currentTarget.closest(".m-row") as HTMLElement)}>
              <Icon name="smile" size={16} />
            </button>
            <button type="button" aria-label="Reply" onClick={() => onReply(m)}>
              <Icon name="reply" size={16} />
            </button>
          </div>
        )}
      </div>
      {m.pending?.state === "failed" && (
        <p className="send-failed" role="alert">
          {m.pending.error || "Not sent."}{" "}
          <button type="button" className="inline-link" onClick={() => onRetry?.(m)}>
            Retry
          </button>
          {" · "}
          <button type="button" className="inline-link" onClick={() => onDiscard?.(m)}>
            Delete
          </button>
        </p>
      )}
      {m.pending?.state === "queued" && last && <p className="send-queued">Waiting for connection. It&apos;ll send by itself.</p>}
      {stranger && !mine && !m.deleted && looksLikeContact(m.content) && (
        <p className="contact-flag" role="note">
          <Icon name="shield" size={13} /> Never share your number, photos or money with strangers.
        </p>
      )}
      {reactions.length > 0 && (
        <div className="reacts">
          {reactions.map(([emoji, ids]) => (
            <button
              key={emoji}
              type="button"
              className={ids.includes(meId ?? -1) ? "on" : ""}
              onClick={() => onReact(m.id, mineEmoji === emoji ? null : emoji)}
              aria-label={`${emoji} ${ids.length}`}
            >
              {emoji}
              {ids.length > 1 && <small>{ids.length}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// --- the list ---------------------------------------------------------------------------------

type MenuState = { m: Msg; style: CSSProperties; mine: string | null; confirmDelete: boolean; picker: boolean; at: number };

export default function MessageList({ items, me, showNames, stranger, onReact, onReply, onEdit, onDelete, extraActions, onWatch, renderCard, onRetry, onDiscard, newFrom }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const maxSeen = useRef<number | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const meId = me?.id;

  // A new warm message from the other side plays its effect once.
  useEffect(() => {
    const top = items.reduce((mx, m) => Math.max(mx, m.id), 0);
    if (maxSeen.current === null) {
      maxSeen.current = top;
      return;
    }
    const fresh = items.filter((m) => m.id > (maxSeen.current ?? 0) && !m.mine && !m.deleted && m.content);
    maxSeen.current = Math.max(maxSeen.current, top);
    const mood = fresh.map((m) => moodOf(m.content)).find(Boolean);
    const box = anchor.current?.closest(".messages");
    if (mood && box) burst(box, mood);
  }, [items]);

  const openMenu = useCallback(
    (m: Msg, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const width = 280;
      const left = Math.min(Math.max(8, m.mine ? r.right - width : r.left), window.innerWidth - width - 8);
      const below = r.bottom + 260 < window.innerHeight;
      const style = { "--x": `${left}px`, "--y": `${below ? r.bottom + 6 : Math.max(8, r.top - 260)}px` } as CSSProperties;
      setMenu({ m, style, mine: myReaction(m, meId), confirmDelete: false, picker: false, at: Date.now() });
    },
    [meId],
  );

  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [menu]);

  function react(emoji: string) {
    if (!menu) return;
    rememberEmoji(emoji);
    onReact(menu.m.id, menu.mine === emoji ? null : emoji);
    setMenu(null);
  }

  const sel = menu?.m;
  const age = menu && sel ? menu.at - new Date(sel.createdAt).getTime() : 0;
  const canEdit = !!sel && sel.mine && !!onEdit && !!sel.content && !sel.attachment && age < EDIT_MS;
  const canDelete = !!sel && sel.mine && !!onDelete && age < DELETE_MS;

  return (
    <>
      <span ref={anchor} hidden />
      {items.map((m, i) => {
        const prev = items[i - 1];
        const next = items[i + 1];
        const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
        const close = (a?: Msg, b?: Msg) =>
          !!a && !!b && a.senderId === b.senderId && dayKey(a.createdAt) === dayKey(b.createdAt) &&
          Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < GROUP_GAP_MS;
        return (
          <Fragment key={m.id}>
            {newDay && (
              <div className="day-sep" role="separator">
                <span>{dayLabel(m.createdAt)}</span>
              </div>
            )}
            {newFrom && m.id === newFrom.id && (
              <div className="new-sep" role="separator" data-new-sep="">
                <span>{newFrom.count === 1 ? "1 new message" : `${newFrom.count} new messages`}</span>
              </div>
            )}
            {m.card ? (
              <div className="m-card">{renderCard?.(m)}</div>
            ) : (
            <Bubble
              m={m}
              first={!close(prev, m) || newDay}
              last={!close(m, next)}
              meId={meId}
              meNick={me?.nickname}
              showNames={showNames}
              stranger={stranger}
              onMenu={openMenu}
              onReact={onReact}
              onReply={onReply}
              onLink={setLink}
              onWatch={onWatch}
              onRetry={onRetry}
              onDiscard={onDiscard}
            />
            )}
          </Fragment>
        );
      })}

      {menu && sel && (
        <div className="msg-sheet-veil" onClick={() => setMenu(null)}>
          <div className="msg-sheet" style={menu.style} role="menu" aria-label="Message actions" onClick={(e) => e.stopPropagation()}>
            {menu.picker ? (
              <EmojiPicker onPick={react} onClose={() => setMenu({ ...menu, picker: false })} />
            ) : (
              <div className="quick-react">
                {QUICK_REACTIONS.map((e) => (
                  <button key={e} type="button" className={menu.mine === e ? "on" : ""} onClick={() => react(e)} aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
                <button type="button" className="more-react" aria-label="More emoji" onClick={() => setMenu({ ...menu, picker: true })}>
                  <Icon name="plus" size={18} />
                </button>
              </div>
            )}
            {menu.confirmDelete ? (
              <div className="sheet-confirm">
                <p>Delete this message for everyone?</p>
                <div>
                  <button type="button" onClick={() => setMenu(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onDelete?.(sel);
                      setMenu(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="sheet-actions">
                <button type="button" role="menuitem" onClick={() => { onReply(sel); setMenu(null); }}>
                  <Icon name="reply" size={18} /> Reply
                </button>
                {sel.content && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      navigator.clipboard?.writeText(sel.content).catch(() => undefined);
                      setMenu(null);
                    }}
                  >
                    <Icon name="copy" size={18} /> Copy
                  </button>
                )}
                {canEdit && (
                  <button type="button" role="menuitem" onClick={() => { onEdit?.(sel); setMenu(null); }}>
                    <Icon name="edit" size={18} /> Edit
                  </button>
                )}
                {canDelete && (
                  <button type="button" role="menuitem" className="danger" onClick={() => setMenu({ ...menu, confirmDelete: true })}>
                    <Icon name="trash" size={18} /> Delete for everyone
                  </button>
                )}
                {extraActions?.(sel).map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    role="menuitem"
                    className={a.danger ? "danger" : ""}
                    onClick={() => {
                      a.onClick();
                      setMenu(null);
                    }}
                  >
                    {a.icon && <Icon name={a.icon} size={18} />} {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {link && (
        <div className="msg-sheet-veil" onClick={() => setLink(null)}>
          <div className="link-guard" role="alertdialog" aria-label="Open link" onClick={(e) => e.stopPropagation()}>
            <Icon name="shield" size={22} />
            <p>
              A stranger sent this link. Only open it if you trust it.
              <b>{link.replace(/^https?:\/\//i, "").slice(0, 80)}</b>
            </p>
            <div>
              <button type="button" onClick={() => setLink(null)}>
                Cancel
              </button>
              <a className="go" href={link} target="_blank" rel="noopener noreferrer nofollow ugc" onClick={() => setLink(null)}>
                Open link
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** "↓ 3 new" at the bottom of the list once the reader scrolled up. */
export function JumpToLatest({ away, unseen, onClick }: { away: boolean; unseen: number; onClick: () => void }) {
  if (!away) return null;
  return (
    <button type="button" className="jump-latest" onClick={onClick} aria-label="Jump to the latest messages">
      <Icon name="down" size={18} />
      {unseen > 0 && <b>{unseen > 99 ? "99+" : unseen}</b>}
    </button>
  );
}
