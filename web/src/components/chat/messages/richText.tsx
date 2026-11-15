"use client";

import { Fragment, type ReactNode } from "react";

/*
 * What a message's text turns into on screen: links, @mentions, a soft highlight on warm words
 * ("love you", "happy birthday"), masked swear words, and big emoji when a message is only emoji.
 * Pure functions: nothing here touches the network.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
const MENTION_RE = /(^|\s)@([\w.-]{2,18})/g;

/** Phrases that get a gentle highlight, and the little effect a new one plays once. */
export type Mood = "love" | "party" | "cheer";
const MOODS: { mood: Mood; words: RegExp; emoji: RegExp | null }[] = [
  {
    mood: "love",
    words: /\b(?:i\s*love\s*(?:you|u)|love\s*(?:you|u|ya)|luv\s*(?:you|u)|miss(?:ing)?\s*(?:you|u)|my\s*love|sweetheart|xoxo)\b/i,
    emoji: /❤️|😍|🥰|😘/u,
  },
  {
    mood: "party",
    words: /\b(?:happy\s*birthday|hbd|congrat(?:s|ulations)?|happy\s*new\s*year|happy\s*diwali|merry\s*christmas|eid\s*mubarak)\b/i,
    emoji: /🎉|🎂|🥳/u,
  },
  {
    mood: "cheer",
    words: /\b(?:good\s*(?:morning|night|luck)|well\s*done|great\s*job|proud\s*of\s*you|thank\s*(?:you|u)|thanks|you'?re\s*(?:awesome|amazing|the\s*best))\b/i,
    emoji: null,
  },
];
const MOOD_WORD_RE = new RegExp(MOODS.map((m) => m.words.source).join("|"), "gi");

export function moodOf(text: string): Mood | null {
  for (const m of MOODS) if (m.words.test(text) || m.emoji?.test(text)) return m.mood;
  return null;
}

// Common English swear words; masked by default (a setting on the Me screen turns it off).
const SWEARS = [
  "fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "bitch", "bastard", "asshole", "dick",
  "pussy", "cunt", "slut", "whore", "wanker", "twat", "prick", "cock", "nigga", "nigger", "faggot", "retard",
];
const SWEAR_RE = new RegExp(`\\b(${SWEARS.join("|")})\\b`, "gi");
const FILTER_KEY = "vchat.cleanWords";

export function cleanWordsOn(): boolean {
  try {
    return localStorage.getItem(FILTER_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setCleanWords(on: boolean) {
  try {
    localStorage.setItem(FILTER_KEY, on ? "on" : "off");
  } catch {
    /* private mode: stays on */
  }
}

export function maskSwears(text: string): string {
  return text.replace(SWEAR_RE, (w) => w[0] + "•".repeat(w.length - 1));
}

const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;

/** 1–3 emoji and nothing else: shown big, without a bubble. */
export function isJumboEmoji(text: string): boolean {
  if (!text || text.length > 24 || !EMOJI_ONLY_RE.test(text) || /^[\d#*\s]+$/.test(text)) return false;
  const count = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text.trim())].filter(
    (s) => s.segment.trim(),
  ).length;
  return count > 0 && count <= 3;
}

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}

export function firstYoutube(text: string): { id: string; url: string } | null {
  for (const m of text.matchAll(URL_RE)) {
    const id = youtubeId(m[0]);
    if (id) return { id, url: href(m[0]) };
  }
  return null;
}

export function mentions(text: string, nickname: string | undefined): boolean {
  if (!nickname) return false;
  for (const m of text.matchAll(MENTION_RE)) if (m[2].toLowerCase() === nickname.toLowerCase()) return true;
  return false;
}

function href(raw: string) {
  return raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw;
}

function shortLink(raw: string) {
  const s = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
}

export type RichOptions = {
  /** "@you" in rooms */
  me?: string;
  /** Called instead of following a link (random chat asks first). */
  onLink?: (url: string) => void;
  clean?: boolean;
};

/** Text -> nodes. Links first, then mentions and warm words inside the plain parts. */
export function renderRich(text: string, opts: RichOptions = {}): ReactNode {
  const shown = opts.clean ? maskSwears(text) : text;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of shown.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(<Fragment key={key++}>{decorate(shown.slice(last, start), opts, () => key++)}</Fragment>);
    const url = href(m[0]);
    out.push(
      <a
        key={key++}
        className="msg-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        onClick={(e) => {
          e.stopPropagation();
          if (opts.onLink) {
            e.preventDefault();
            opts.onLink(url);
          }
        }}
      >
        {shortLink(m[0])}
      </a>,
    );
    last = start + m[0].length;
  }
  if (last < shown.length) out.push(<Fragment key={key++}>{decorate(shown.slice(last), opts, () => key++)}</Fragment>);
  return out;
}

function decorate(part: string, opts: RichOptions, nextKey: () => number): ReactNode[] {
  // Mentions and warm words, in the order they appear.
  type Hit = { start: number; end: number; node: ReactNode };
  const hits: Hit[] = [];
  for (const m of part.matchAll(MENTION_RE)) {
    const start = (m.index ?? 0) + m[1].length;
    const isMe = !!opts.me && m[2].toLowerCase() === opts.me.toLowerCase();
    hits.push({
      start,
      end: start + m[2].length + 1,
      node: (
        <span key={nextKey()} className={`mention${isMe ? " me" : ""}`}>
          @{m[2]}
        </span>
      ),
    });
  }
  for (const m of part.matchAll(MOOD_WORD_RE)) {
    if (!m[0]) continue;
    const start = m.index ?? 0;
    if (hits.some((h) => start < h.end && start + m[0].length > h.start)) continue;
    hits.push({
      start,
      end: start + m[0].length,
      node: (
        <span key={nextKey()} className={`warm warm-${moodOf(m[0]) ?? "cheer"}`}>
          {m[0]}
        </span>
      ),
    });
  }
  hits.sort((a, b) => a.start - b.start);
  const nodes: ReactNode[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start < at) continue;
    if (h.start > at) nodes.push(part.slice(at, h.start));
    nodes.push(h.node);
    at = h.end;
  }
  if (at < part.length) nodes.push(part.slice(at));
  return nodes;
}
