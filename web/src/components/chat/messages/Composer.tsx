"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../bits";
import { MAX_VOICE_SECONDS, useRecorder } from "../media/useRecorder";
import EmojiPicker from "./EmojiPicker";
import type { Msg } from "./MessageList";

const MAX_ROWS_PX = 132;
const HOLD_MS = 350;
const CANCEL_SLIDE_PX = 90;

type Props = {
  id: string;
  placeholder: string;
  disabled?: boolean;
  /** Sends text. Return false if it couldn't go (offline): the draft stays. */
  onSend: (text: string) => boolean;
  onTyping?: () => void;
  replying?: Msg | null;
  replyName?: string;
  onCancelReply?: () => void;
  /** Editing one of your messages: the box holds its text, Send saves it. */
  editing?: Msg | null;
  onCancelEdit?: () => void;
  /** Voice messages: shown instead of Send while the box is empty. */
  onVoice?: (blob: Blob) => void;
  /** Buttons on the left of the box (photo…). */
  left?: ReactNode;
  /** A strip of actions above the box (random chat: Next, End, photo). */
  toolbar?: ReactNode;
  autoFocusKey?: unknown;
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
}: Props) {
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(false);
  const [holding, setHolding] = useState<null | { x: number; t: number; slide: number }>(null);
  const [lockedRec, setLockedRec] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const holdRef = useRef<{ x: number; t: number; slide: number } | null>(null);
  const editingId = editing?.id;
  const voice = useRecorder((blob) => onVoice?.(blob));

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

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    if (onSend(text)) {
      setDraft("");
      setPicker(false);
    }
  }

  function insertEmoji(e: string) {
    const el = boxRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + e + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
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
                setDraft("");
                onCancelEdit?.();
              } else onCancelReply?.();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {picker && (
        <div className="picker-dock">
          <EmojiPicker onPick={insertEmoji} onClose={() => setPicker(false)} />
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
              aria-label="Emoji"
              aria-expanded={picker}
              disabled={disabled}
              onClick={() => setPicker((p) => !p)}
            >
              <Icon name="smile" />
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
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value) onTyping?.();
              }}
              onKeyDown={(e) => {
                // Laptops: Enter sends, Shift+Enter is a new line. Phones: the Send button sends.
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(hover: hover)").matches) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape" && (editing || replying)) {
                  if (editing) {
                    setDraft("");
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
            <button className="send-btn" type="submit" disabled={disabled || empty} aria-label={editing ? "Save" : "Send"}>
              <Icon name={editing ? "check" : "send"} />
            </button>
          )}
        </form>
      )}
    </div>
  );
}
