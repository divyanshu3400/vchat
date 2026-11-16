"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../bits";
import { MAX_VOICE_SECONDS, useRecorder } from "../media/useRecorder";
import { readDraft, writeDraft } from "./drafts";
import MediaPanel, { type PanelTab } from "./MediaPanel";
import { gifText } from "@/lib/gifs";
import type { Msg } from "./MessageList";

const MAX_ROWS_PX = 132;
const HOLD_MS = 350;
const CANCEL_SLIDE_PX = 90;

type Props = {
  id: string;
  placeholder: string;
  disabled?: boolean;
  /** Sends text. Return (or resolve to) false if it didn't go (offline, or a warning the user
   * backed out of): the draft stays. */
  onSend: (text: string) => boolean | Promise<boolean>;
  onTyping?: () => void;
  replying?: Msg | null;
  replyName?: string;
  onCancelReply?: () => void;
  /** Editing one of your messages: the box holds its text, Send saves it. */
  editing?: Msg | null;
  onCancelEdit?: () => void;
  /** Voice messages: shown instead of Send while the box is empty. "twice": can be played 2 times. */
  onVoice?: (blob: Blob, view: "" | "twice") => void;
  /** Buttons on the left of the box (photo…). */
  left?: ReactNode;
  /** A strip of actions above the box (random chat: Next, End, photo). */
  toolbar?: ReactNode;
  autoFocusKey?: unknown;
  /** Keeps unsent text for this chat on this device ("dm:12", "room:lobby"). */
  draftKey?: string;
};

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Composer({
  id,
  placeholder,
  disabled,
  onSend,
  onTyping,
  replying,
  replyName,
  onCancelReply,
  editing,
  onCancelEdit,
  onVoice,
  left,
  toolbar,
  autoFocusKey,
  draftKey,
}: Props) {
  const [draft, setDraft] = useState("");
  // Emoji / GIFs / stickers where the keyboard was (Telegram-style). null: the keyboard's turn.
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [lastTab, setLastTab] = useState<PanelTab>("emoji");
  const [expanded, setExpanded] = useState(false);

  const [holding, setHolding] = useState<null | { x: number; t: number; slide: number }>(null);
  const [lockedRec, setLockedRec] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const holdRef = useRef<{ x: number; t: number; slide: number } | null>(null);
  const shiftHeld = useRef(false);
  const editingId = editing?.id;
  // A recording that can be played only 2 times (set while recording, before Send).
  const [twice, setTwice] = useState(false);
  const twiceRef = useRef(false);
  const voice = useRecorder((blob) => {
    onVoice?.(blob, twiceRef.current ? "twice" : "");
    twiceRef.current = false;
    setTwice(false);
  });

  // This chat's unsent text, from the last visit.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this device's storage after mount (not on the server)
    setDraft(readDraft(draftKey));
  }, [draftKey]);

  /** Typing: the box, and this chat's saved draft (not while editing an old message). */
  function typeText(text: string) {
    setDraft(text);
    if (!editing) writeDraft(draftKey, text);
  }

  // Start editing: the box takes the message's text.
  useEffect(() => {
    if (editingId === undefined) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the box mirrors the message picked for editing
    setDraft(editing?.content ?? "");
    requestAnimationFrame(() => boxRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a different message is picked
  }, [editingId]);

  useEffect(() => {
    if (replying) boxRef.current?.focus({ preventScroll: true });
  }, [replying]);

  useEffect(() => {
    if (autoFocusKey !== undefined) boxRef.current?.focus({ preventScroll: true });
  }, [autoFocusKey]);

  // Grow with the text, up to about five lines.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Empty: one line, even when a long placeholder would wrap in a narrow box.
    if (draft) el.style.height = `${Math.min(el.scrollHeight, MAX_ROWS_PX)}px`;
  }, [draft]);

  function openPanel() {
    setPanel(lastTab);
    boxRef.current?.blur(); // the keyboard goes down, the panel takes its place
  }

  function closePanel(typeNext: boolean) {
    setPanel(null);
    setExpanded(false);
    if (typeNext) boxRef.current?.focus({ preventScroll: true });
  }

  async function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    // Keep typing: the keyboard stays up after a message goes (phones close it on blur).
    // With the emoji panel open, it stays open instead.
    if (!panel) boxRef.current?.focus({ preventScroll: true });
    if (await onSend(text)) {
      if (editing) setDraft(readDraft(draftKey));
      else typeText("");
    }
  }

  function insertEmoji(e: string) {
    const el = boxRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + e + draft.slice(end);
    typeText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      // The emoji panel stays open: move the caret without bringing the keyboard back.
      if (!panel) el.focus();
      el.setSelectionRange(start + e.length, start + e.length);
    });
  }

  // --- voice: hold to record, release to send, slide left to cancel; a quick tap locks it on ---
  function micDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled) return;
    e.preventDefault();
    holdRef.current = { x: e.clientX, t: Date.now(), slide: 0 };
    setHolding(holdRef.current);
    setLockedRec(false);
    twiceRef.current = false;
    setTwice(false);
    voice.start();
  }

  // While the mic is held the composer swaps to the recorder, so follow the finger on the window.
  const isHolding = holding !== null;
  const { finish } = voice;
  useEffect(() => {
    if (!isHolding) return;
    function move(e: PointerEvent) {
      const h = holdRef.current;
      if (!h) return;
      const slide = Math.max(0, h.x - e.clientX);
      if (slide > CANCEL_SLIDE_PX) {
        holdRef.current = null;
        setHolding(null);
        finish(false);
        navigator.vibrate?.(15);
        return;
      }
      holdRef.current = { ...h, slide };
      setHolding(holdRef.current);
    }
    function up() {
      const h = holdRef.current;
      if (!h) return;
      holdRef.current = null;
      setHolding(null);
      if (Date.now() - h.t < HOLD_MS) setLockedRec(true);
      else finish(true);
    }
    function cancel() {
      if (!holdRef.current) return;
      holdRef.current = null;
      setHolding(null);
      finish(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [isHolding, finish]);

  const empty = !draft.trim();
  const recording = voice.active || !!voice.error;

  return (
    <div className="composer2">
      {toolbar && <div className="composer-strip">{toolbar}</div>}
      {(replying || editing) && (
        <div className="reply-bar">
          <Icon name={editing ? "edit" : "reply"} size={18} />
          <div>
            <b>{editing ? "Editing message" : `Replying to ${replyName ?? "message"}`}</b>
            <span>{(editing ?? replying)?.content || (replying?.attachment ? "Attachment" : "")}</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={editing ? "Cancel editing" : "Cancel reply"}
            onClick={() => {
              if (editing) {
                setDraft(readDraft(draftKey));
                onCancelEdit?.();
              } else onCancelReply?.();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {recording ? (
        <div className={`recorder2${holding ? " holding" : ""}`} role="group" aria-label="Recording a voice message">
          {voice.error ? (
            <>
              <span className="recorder-error">{voice.error}</span>
              <button type="button" className="pill-btn" onClick={() => { voice.clearError(); voice.finish(false); }}>
                OK
              </button>
            </>
          ) : (
            <>
              {!holding && (
                <button type="button" className="icon-btn" aria-label="Delete recording" onClick={() => voice.finish(false)}>
                  <Icon name="trash" />
                </button>
              )}
              <span className="rec-dot" aria-hidden="true" />
              <span className="rec-time">{fmt(voice.seconds)}</span>
              {holding ? (
                <span className="rec-slide" style={{ transform: `translateX(${-Math.min(holding.slide, CANCEL_SLIDE_PX)}px)` }}>
                  ‹ Slide to cancel
                </span>
              ) : (
                <span className="rec-wave" aria-hidden="true">
                  {voice.levels.map((l, i) => (
                    <i key={i} style={{ height: `${Math.round(18 + l * 82)}%` }} />
                  ))}
                </span>
              )}
              {!holding && <span className="rec-max">{fmt(MAX_VOICE_SECONDS)}</span>}
              {!holding && (
                <button
                  type="button"
                  className={`twice-btn${twice ? " on" : ""}`}
                  aria-pressed={twice}
                  title={twice ? "Can be played 2 times" : "Let them play it only 2 times"}
                  onClick={() => {
                    twiceRef.current = !twice;
                    setTwice(!twice);
                  }}
                >
                  2×
                </button>
              )}
              {holding ? (
                <span className="send-btn mic-live" aria-label="Release to send">
                  <Icon name="mic" />
                </span>
              ) : (
                <button
                  type="button"
                  className="send-btn"
                  aria-label="Send voice message"
                  disabled={!lockedRec && !voice.active}
                  onClick={() => voice.finish(true)}
                >
                  <Icon name="send" />
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {left}
          <div className="input-shell">
            <button
              type="button"
              className="icon-btn emoji-toggle"
              onPointerDown={(e) => e.preventDefault()}
              aria-label={panel ? "Keyboard" : "Emoji, GIFs and stickers"}
              aria-expanded={!!panel}
              disabled={disabled}
              onClick={() => (panel ? closePanel(true) : openPanel())}
            >
              <Icon name={panel ? "keyboard" : "smile"} />
            </button>
            <textarea
              ref={boxRef}
              id={id}
              className="composer-input"
              rows={1}
              placeholder={placeholder}
              maxLength={1000}
              autoComplete="off"
              enterKeyHint="send"
              aria-label={placeholder}
              value={draft}
              disabled={disabled}
              // Tapping the box brings the keyboard back in place of the panel.
              onFocus={() => panel && closePanel(false)}
              onChange={(e) => {
                // Some Android keyboards send Enter as a typed line break, not a key press.
                const type = (e.nativeEvent as InputEvent).inputType;
                if ((type === "insertLineBreak" || type === "insertParagraph") && !shiftHeld.current) {
                  submit();
                  return;
                }
                typeText(e.target.value);
                if (e.target.value) onTyping?.();
              }}
              onKeyUp={(e) => {
                shiftHeld.current = e.shiftKey;
              }}
              onKeyDown={(e) => {
                shiftHeld.current = e.shiftKey;
                // Enter sends (phones too); Shift+Enter is a new line on a keyboard.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape" && (editing || replying)) {
                  if (editing) {
                    setDraft(readDraft(draftKey));
                    onCancelEdit?.();
                  } else onCancelReply?.();
                }
              }}
            />
          </div>
          {onVoice && empty && !editing ? (
            <button
              type="button"
              className="send-btn"
              aria-label="Hold to record a voice message"
              title="Hold to record, release to send"
              disabled={disabled}
              onPointerDown={micDown}
              onContextMenu={(e) => e.preventDefault()}
            >
              <Icon name="mic" />
            </button>
          ) : (
            <button
              className="send-btn"
              type="submit"
              disabled={disabled || empty}
              aria-label={editing ? "Save" : "Send"}
              // Tapping Send mustn't take the focus from the text box, or the phone keyboard closes.
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
            >
              <Icon name={editing ? "check" : "send"} />
            </button>
          )}
        </form>
      )}
      {panel && !recording && (
        <MediaPanel
          tab={panel}
          setTab={(t) => {
            setPanel(t);
            setLastTab(t);
          }}
          expanded={expanded}
          setExpanded={setExpanded}
          onEmoji={insertEmoji}
          onGif={async (g) => {
            setExpanded(false);
            await onSend(gifText(g));
          }}
        />
      )}
    </div>
  );
}
