"use client";

import { useEffect, useRef, useState } from "react";

/** The device's own emoji, a curated set, plus the ones you used last. No library, no images. */
export const GROUPS: [string, string, string][] = [
  ["Smileys", "😀", "😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 😴 😷 🤒 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 💀 🤡 👻 👽 🤖 💩"],
  ["Love", "❤️", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💌 💋 🌹 🌷 🌸 💐 😻 💑 💏 👩‍❤️‍👨 🫶"],
  ["Hands", "👍", "👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👋 🤚 🖐️ ✋ 👏 🙌 👐 🤲 🤝 🙏 💪 ✍️ 💅 🫡 🫠"],
  ["Fun", "🎉", "🎉 🎊 🎂 🥳 🎁 🎈 ✨ 🔥 💯 ⭐ 🌟 💫 ⚡ 🌈 ☀️ 🌙 ❄️ 🎵 🎶 🎮 ⚽ 🏏 🏀 🏆 🥇 🎬 📸 🎧 💃 🕺"],
  ["Food", "🍕", "☕ 🍵 🧋 🥤 🍺 🍻 🥂 🍷 🍕 🍔 🍟 🌭 🌮 🍜 🍝 🍛 🍣 🍩 🍪 🍫 🍦 🍰 🍓 🍉 🍌 🍎 🥭 🍇"],
  ["Things", "📱", "📱 💻 ⌚ 📷 💡 📚 ✏️ 📌 🔒 🔑 💰 💎 🎓 💼 🚗 ✈️ 🚀 🏠 🌍 🗺️ ⏰ 🎯 🧩 🪄 🛍️"],
];
const RECENT_KEY = "vchat.recentEmoji";
const RECENT_MAX = 24;

export function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function rememberEmoji(e: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...readRecent().filter((x) => x !== e)].slice(0, RECENT_MAX)));
  } catch {
    /* private mode */
  }
}

export default function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [recent] = useState<string[]>(readRecent);
  const [tab, setTab] = useState(recent.length ? -1 : 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function away(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest(".emoji-toggle")) onClose();
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const list = tab === -1 ? recent : GROUPS[tab][2].split(" ");

  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="Emoji">
      <div className="emoji-tabs" role="tablist">
        {recent.length > 0 && (
          <button type="button" role="tab" aria-selected={tab === -1} aria-label="Recent" onClick={() => setTab(-1)}>
            🕘
          </button>
        )}
        {GROUPS.map(([name, icon], i) => (
          <button key={name} type="button" role="tab" aria-selected={tab === i} aria-label={name} onClick={() => setTab(i)}>
            {icon}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {list.map((e) => (
          <button
            key={e}
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
    </div>
  );
}
