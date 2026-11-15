"use client";

import { useEffect, useState } from "react";

type Line =
  | { kind: "them"; who: string; place: string; color: string; text: string }
  | { kind: "me"; text: string }
  | { kind: "sys"; text: string };

// Illustrative conversation for the landing page. Not real users.
const OPENING: Line[] = [
  { kind: "sys", text: "night_owl_22 joined the room" },
  { kind: "them", who: "jules.mtl", place: "Montréal", color: "c-amber", text: "it's 2am and I can't sleep, who else is up?" },
  { kind: "them", who: "mira_reads", place: "London", color: "c-online", text: "7am here, just made coffee. morning shift checking in ☕" },
  { kind: "me", text: "perfect, we've got the whole clock covered 😄" },
];
const SCRIPT: Line[] = [
  { kind: "them", who: "kai.from.manila", place: "Manila", color: "c-rose", text: "3pm here lol, but I'll keep you night people company" },
  { kind: "sys", text: "kai.from.manila sent you a friend request" },
  { kind: "me", text: "accepted! voice chat later?" },
  { kind: "them", who: "night_owl_22", place: "Sydney", color: "c-violet", text: "anyone watching the game tonight? 🏀" },
  { kind: "sys", text: "spam_bot_42 was muted automatically" },
  { kind: "me", text: "wow, mods are quick here" },
  { kind: "them", who: "mira_reads", place: "London", color: "c-online", text: "first time here, why is everyone so nice 😄" },
];

type Shown = Line & { key: number };

export default function ChatPreview() {
  const [lines, setLines] = useState<Shown[]>(OPENING.map((l, i) => ({ ...l, key: i })));
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let key = OPENING.length;
    let timer: ReturnType<typeof setTimeout>;
    const push = (line: Line) => setLines((prev) => [...prev, { ...line, key: key++ }].slice(-6));
    const step = () => {
      const line = SCRIPT[i++ % SCRIPT.length];
      if (line.kind === "them") {
        setTyping(true);
        timer = setTimeout(() => {
          setTyping(false);
          push(line);
          timer = setTimeout(step, 1700);
        }, 1100);
      } else {
        push(line);
        timer = setTimeout(step, 1900);
      }
    };
    timer = setTimeout(step, 1800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="preview" aria-label="Example of a vChat room" role="img">
      <div className="preview-top">
        <div className="room-name">
          # late-night-talks
          <small>
            <span className="dot pulse" /> live now
          </small>
        </div>
        <div className="icons" aria-hidden="true">
          <span>
            <svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </span>
          <span>
            <svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="3" /><path d="M16 10l5-3v10l-5-3" /></svg>
          </span>
        </div>
      </div>
      <div className="stream" aria-hidden="true">
        {lines.map((l) =>
          l.kind === "sys" ? (
            <div key={l.key} className="b sys"><div className="t">{l.text}</div></div>
          ) : l.kind === "me" ? (
            <div key={l.key} className="b me"><div className="t">{l.text}</div></div>
          ) : (
            <div key={l.key} className="b">
              <span className={`who ${l.color}`}>{l.who}<small>{l.place}</small></span>
              <div className="t">{l.text}</div>
            </div>
          ),
        )}
        {typing && (
          <div className="b"><div className="typing"><i /><i /><i /></div></div>
        )}
      </div>
      <div className="composer" aria-hidden="true">
        <div>Say something nice…</div>
        <span><svg viewBox="0 0 24 24"><path d="M3 20l18-8L3 4v6l12 2-12 2z" /></svg></span>
      </div>
    </div>
  );
}
