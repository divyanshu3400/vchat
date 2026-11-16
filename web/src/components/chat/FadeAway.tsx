"use client";

import { useEffect, useState } from "react";

const LEAVE_MS = 420;

/**
 * Shows its children, then fades and folds them away: when `show` turns false, or `after` ms
 * after it first appears. Once gone it renders nothing, so it leaves no gap.
 */
export default function FadeAway({ show = true, after, children }: { show?: boolean; after?: number; children: React.ReactNode }) {
  const [expired, setExpired] = useState(false);
  const [gone, setGone] = useState(false);
  const visible = show && !expired;

  useEffect(() => {
    if (after === undefined) return;
    const t = setTimeout(() => setExpired(true), after);
    return () => clearTimeout(t);
  }, [after]);

  useEffect(() => {
    if (visible) return;
    const t = setTimeout(() => setGone(true), LEAVE_MS);
    return () => clearTimeout(t);
  }, [visible]);

  if (gone && !visible) return null;
  return <div className={`fade-away${visible ? "" : " out"}`}>{children}</div>;
}
