"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchGifs, type GifItem } from "@/lib/api";
import { gifSmall } from "@/lib/gifs";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";
import { GROUPS, readRecent, rememberEmoji } from "./EmojiPicker";

export type PanelTab = "emoji" | "gifs" | "stickers";

// One tap searches (like Telegram's row of moods above GIFs).
const MOODS: [string, string][] = [
  ["❤️", "love"],
  ["👍", "thumbs up"],
  ["👎", "nope"],
  ["🎉", "party"],
  ["😂", "lol"],
  ["😀", "happy"],
  ["😢", "sad"],
  ["😮", "wow"],
  ["😡", "angry"],
  ["🙏", "thank you"],
  ["👋", "hello"],
  ["😴", "sleepy"],
];

/**
 * Where the keyboard was: emoji, GIFs and stickers, switched by the tabs at the bottom (like
 * Telegram). Scrolling GIFs or searching makes it tall; the arrow on top brings it back down.
 */
export default function MediaPanel({
  tab,
  setTab,
  expanded,
  setExpanded,
  onEmoji,
  onGif,
}: {
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  expanded: boolean;
  setExpanded: (e: boolean) => void;
  onEmoji: (emoji: string) => void;
  onGif: (gif: GifItem) => void;
}) {
  return (
    <div className={`media-panel${expanded ? " expanded" : ""}`} role="dialog" aria-label="Emoji, GIFs and stickers">
      {expanded && (
        <button type="button" className="mp-collapse" onClick={() => setExpanded(false)} aria-label="Make smaller">
          <Icon name="down" size={20} />
        </button>
      )}
      <div className="mp-body">
        {tab === "emoji" ? (
          <EmojiPane onPick={onEmoji} />
        ) : (
          <GifPane key={tab} kind={tab} onPick={onGif} expanded={expanded} onExpand={() => setExpanded(true)} />
        )}
      </div>
      <div className="mp-tabs" role="tablist">
        {(
          [
            ["emoji", "Emoji"],
            ["gifs", "GIFs"],
            ["stickers", "Stickers"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmojiPane({ onPick }: { onPick: (e: string) => void }) {
  const [recent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecent()));
  const gridRef = useRef<HTMLDivElement>(null);
  const sections: [string, string, string[]][] = [
    ...(recent.length ? ([["Recent", "🕘", recent]] as [string, string, string[]][]) : []),
    ...GROUPS.map(([name, icon, list]) => [name, icon, list.split(" ")] as [string, string, string[]]),
  ];

  return (
    <>
      <div className="mp-cats" role="tablist" aria-label="Emoji groups">
        {sections.map(([name, icon]) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            onClick={() => gridRef.current?.querySelector(`[data-sec="${name}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
          >
            {icon}
          </button>
        ))}
      </div>
      <div className="mp-emoji" ref={gridRef}>
        {sections.map(([name, , list]) => (
          <section key={name} data-sec={name}>
            <h3>{name}</h3>
            <div className="mp-emoji-grid">
              {list.map((e) => (
                <button
                  key={`${name}-${e}`}
                  type="button"
                  aria-label={e}
                  onClick={() => {
                    rememberEmoji(e);
                    onPick(e);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function GifPane({
  kind,
  onPick,
  expanded,
  onExpand,
}: {
  kind: "gifs" | "stickers";
  onPick: (gif: GifItem) => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { getAccess } = useChat();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GifItem[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0);

  // Made smaller: back to the top, so the shrinking box doesn't count as scrolling down.
  useEffect(() => {
    if (expanded) return;
    boxRef.current?.scrollTo({ top: 0 });
    lastTop.current = 0;
  }, [expanded]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    loading.current = true;
    getAccess()
      .then((access) => fetchGifs(kind, query, 0, access))
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNext(res.next);
        setError("");
        setLoadedFor(query);
        boxRef.current?.scrollTo({ top: 0 });
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "GIFs aren't available right now."))
      .finally(() => {
        loading.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [kind, query, getAccess]);

  async function more() {
    if (loading.current || next === null) return;
    loading.current = true;
    setBusy(true);
    try {
      const res = await fetchGifs(kind, query, next, await getAccess());
      setItems((l) => [...l, ...res.items.filter((g) => !l.some((x) => x.id === g.id))]);
      setNext(res.next);
    } catch {
      setNext(null);
    }
    loading.current = false;
    setBusy(false);
  }

  const what = kind === "gifs" ? "GIFs" : "stickers";
  return (
    <>
      <div className="mp-search-row">
        <label className="mp-search">
          <Icon name="search" size={16} />
          <input
            placeholder={`Search ${what}`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={onExpand}
            maxLength={50}
            enterKeyHint="search"
          />
          {q && (
            <button type="button" className="mp-clear" aria-label="Clear search" onClick={() => setQ("")}>
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        <div className="mp-moods" aria-label="Quick searches">
          {MOODS.map(([emoji, term]) => (
            <button key={term} type="button" className={query === term ? "on" : ""} aria-label={term} onClick={() => setQ(query === term ? "" : term)}>
              {emoji}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`mp-gifs${kind === "stickers" ? " stickers" : ""}`}
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          // Scrolling down through GIFs (not the box resizing): give them the whole screen.
          const down = el.scrollTop > lastTop.current;
          lastTop.current = el.scrollTop;
          if (!expanded && down && el.scrollTop > 40) onExpand();
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) more();
        }}
      >
        {error ? (
          <p className="gif-note">{error}</p>
        ) : !items.length ? (
          <p className="gif-note">{loadedFor !== query ? "Loading…" : `No ${what} for “${query}”.`}</p>
        ) : (
          // Columns inside the scroller (columns on a fixed-height box would spill sideways).
          <div className="mp-gif-cols">
            {items.map((g) => (
              <button key={g.id} type="button" className="gif-cell" onClick={() => onPick(g)} aria-label={g.title || "GIF"} style={{ aspectRatio: `${g.w} / ${g.h}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY's CDN */}
                <img src={gifSmall(g.id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </button>
            ))}
          </div>
        )}
        {busy && <p className="gif-note">Loading…</p>}
        <p className="gif-credit">Powered by GIPHY</p>
      </div>
    </>
  );
}
