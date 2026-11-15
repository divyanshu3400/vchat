"use client";

import { useCallback, useLayoutEffect, useRef, useState, type DependencyList, type RefObject } from "react";

const NEAR_BOTTOM_PX = 80;

/**
 * Follow new messages while the reader is at the bottom; once they scroll up, stay put and count
 * what arrived below ("↓ 3 new"). `count` is the number of messages shown.
 */
export function useStickyScroll(listRef: RefObject<HTMLDivElement | null>, count: number, deps: DependencyList = []) {
  const stick = useRef(true);
  const countRef = useRef(count);
  const [awayAt, setAwayAt] = useState<number | null>(null);

  useLayoutEffect(() => {
    countRef.current = count;
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass what changes the height
  }, [count, listRef, ...deps]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    setAwayAt((at) => (near ? null : (at ?? countRef.current)));
  }, [listRef]);

  /** Before sending: the reader wants to see their own message. */
  const follow = useCallback(() => {
    stick.current = true;
  }, []);

  /** Before loading older messages above: keep the reader where they are. */
  const hold = useCallback(() => {
    stick.current = false;
  }, []);

  const jump = useCallback(() => {
    const el = listRef.current;
    stick.current = true;
    setAwayAt(null);
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [listRef]);

  return { onScroll, follow, hold, jump, away: awayAt !== null, unseen: awayAt === null ? 0 : Math.max(0, count - awayAt) };
}
