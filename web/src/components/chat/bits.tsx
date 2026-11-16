/** Small presentational pieces shared by the chat screens. */

// Warm, readable on both themes; picked by nickname so a person keeps their colour.
const AVATAR_COLOURS = ["#FFB23F", "#3DDCB0", "#FF8FA9", "#A9B8FF", "#FFD36E", "#C9A7FF", "#7FD8FF", "#F7A36B"];

function colourFor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

export function Avatar({
  name,
  size = 40,
  online,
}: {
  name: string;
  size?: number;
  /** undefined: no presence dot at all. */
  online?: boolean;
}) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: colourFor(name), fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {name.replace(/[^a-z0-9]/gi, "")[0]?.toUpperCase() ?? "?"}
      {online !== undefined && <i className={`presence-dot${online ? " on" : ""}`} />}
    </span>
  );
}

const ICONS: Record<string, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  shuffle: "M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  chat: "M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.4A8 8 0 1 1 21 12z",
  hash: "M5 9h15M4 15h15M10 3 8 21M16 3l-2 18",
  me: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  crown: "M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  back: "M15 5l-7 7 7 7",
  min: "M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  send: "M4 20 21 12 4 4l2.5 8zM6.5 12H13",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z",
  plus: "M12 5v14M5 12h14",
  expand: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  play: "M7 4.5v15l12-7.5z",
  pause: "M8 5v14M16 5v14",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0",
  phoneapp: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  reply: "M10 8 4 13l6 5M4 13h11a5 5 0 0 1 5 5v1",
  smile: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01",
  copy: "M9 9h10v12H9zM5 15V3h10",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  down: "M6 9l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  checks: "M2 12.5 6.5 17 16 7M10.5 15.5 12 17l9.5-10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  image: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 10a1.5 1.5 0 1 0 0-.01M21 15l-5-5-11 10",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  micoff: "M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.6 5.3M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  video: "M3 7.5A2.5 2.5 0 0 1 5.5 5h8A2.5 2.5 0 0 1 16 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 16.5zM16 10.5l5-3v9l-5-3",
  videooff: "M16 10.5l5-3v9l-5-3M10 5h3.5A2.5 2.5 0 0 1 16 7.5V11M3 3l18 18M14.6 18.9a2.5 2.5 0 0 1-1.1.1h-8A2.5 2.5 0 0 1 3 16.5v-9c0-.9.5-1.7 1.2-2.1",
  hangup: "M3 14.5c5-5 13-5 18 0l-2.5 2.5-3.5-1.5V13a10 10 0 0 0-6 0v2.5L5.5 17z",
  shield: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6zM9 12l2 2 4-4",
};

export function Icon({ name, size = 20 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}
