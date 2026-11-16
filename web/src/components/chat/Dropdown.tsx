"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./bits";

/**
 * The "⋯" menu of a chat. Opens and closes with a short animation (it stays in the page,
 * hidden and inert, so closing can animate too). A tap anywhere outside or Escape closes it.
 */
export default function Dropdown({
  open,
  onToggle,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) closeRef.current();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button type="button" className={`icon-btn${open ? " pressed" : ""}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <Icon name="more" />
      </button>
      <div className={`dd${open ? " open" : ""}`} role="menu" aria-label={label} aria-hidden={!open} inert={!open}>
        {children}
      </div>
    </div>
  );
}

type Tone = "brand" | "red" | "amber" | "blue" | "danger" | "muted";

export function DropItem({
  icon,
  tone = "brand",
  hint,
  onClick,
  children,
}: {
  icon: string;
  tone?: Tone;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" role="menuitem" className={`dd-item tone-${tone}`} onClick={onClick}>
      <span className="dd-ic" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="dd-text">
        <b>{children}</b>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

export function DropSep() {
  return <span className="dd-sep" role="separator" />;
}
