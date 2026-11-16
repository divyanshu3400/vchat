"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, fetchGifs, type GifItem } from "@/lib/api";
import { gifSmall } from "@/lib/gifs";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";

/**
 * GIFs and stickers from GIPHY (through our server, rated pg-13 or milder).
 * Trending until you type; results load in pages as you scroll.
 */
export default function GifPicker({ onPick, onClose }: { onPick: (gif: GifItem) => void; onClose: () => void }) {
  const { getAccess } = useChat();
  const [kind, setKind] = useState<"gifs" | "stickers">("gifs");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GifItem[]>([]);
  const [next, setNext] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Which search the shown results belong to (a different one is still loading).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const current = `${kind}|${query}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const loading = useRef(false);

  // Typing settles for a moment before searching.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  // A new search or tab starts from the first page.
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
        setLoadedFor(`${kind}|${query}`);
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

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="gif-picker" role="dialog" aria-label="GIFs and stickers">
      <div className="gif-head">
        <label className="gif-search">
          <Icon name="search" size={16} />
          <input
            placeholder={kind === "gifs" ? "Search GIFs" : "Search stickers"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            maxLength={50}
            enterKeyHint="search"
          />
        </label>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="gif-tabs" role="tablist">
        {(["gifs", "stickers"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {k === "gifs" ? "GIFs" : "Stickers"}
          </button>
        ))}
      </div>
      <div
        className={`gif-grid${kind === "stickers" ? " stickers" : ""}`}
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) more();
        }}
      >
        {error ? (
          <p className="gif-note">{error}</p>
        ) : !items.length ? (
          <p className="gif-note">{loadedFor !== current ? "Loading…" : `No ${kind === "gifs" ? "GIFs" : "stickers"} for “${query}”.`}</p>
        ) : (
          items.map((g) => (
            <button key={g.id} type="button" className="gif-cell" onClick={() => onPick(g)} aria-label={g.title || "GIF"} style={{ aspectRatio: `${g.w} / ${g.h}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- GIPHY's CDN */}
              <img src={gifSmall(g.id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))
        )}
        {busy && <p className="gif-note">Loading…</p>}
      </div>
      <p className="gif-credit">Powered by GIPHY</p>
    </div>
  );
}
