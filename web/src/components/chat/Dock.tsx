"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ADS_ON } from "@/lib/ads";
import { usePlus } from "@/lib/plus";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import DmConversation from "./DmConversation";
import { StrangerWindow } from "./screens/StrangerScreen";
import { useStranger } from "./stranger/StrangerProvider";

/**
 * Floating chat windows, laptop only (1280 px and wider): friends' chats and the random chat,
 * tall, side by side from the right. At most MAX_OPEN at once; opening one more moves the oldest
 * into the row of avatars above the chat list (click it to bring it back). On smaller screens
 * openChat() and openRandom() go to the full-screen chat instead.
 */
const MAX_OPEN = 3;
const WINDOW_SLOT = 328; // a window and the gap after it
const LEFT_COLUMNS = 76 + 340 + 16; // icon rail + chat list + a margin
const AD_RAIL = 348;

const onResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

/** How many windows fit next to the chat list (and the ad column when ads show). */
function useMaxOpen() {
  const plus = usePlus();
  const width = useSyncExternalStore(onResize, () => window.innerWidth, () => 1440);
  const free = width - LEFT_COLUMNS - (ADS_ON && !plus ? AD_RAIL : 0);
  return Math.max(1, Math.min(MAX_OPEN, Math.floor(free / WINDOW_SLOT)));
}
/** The random chat's window id (user ids start at 1). */
export const RANDOM_WINDOW = 0;

type DockValue = {
  openChat: (userId: number) => void;
  /** The random chat window (laptops), or the random chat page (phones). */
  openRandom: () => void;
  isDesktop: boolean;
  /** Chats moved out of the windows, newest first: shown as avatars above the chat list. */
  parked: number[];
};

const DockContext = createContext<DockValue | null>(null);

export function useDock() {
  const ctx = useContext(DockContext);
  if (!ctx) throw new Error("useDock must be used inside <DockProvider>");
  return ctx;
}

type DockState = { open: number[]; heads: number[]; minimized: number[] };

export function DockProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [state, setState] = useState<DockState>({ open: [], heads: [], minimized: [] });
  const maxOpen = useMaxOpen();
  const maxRef = useRef(maxOpen);
  useEffect(() => {
    maxRef.current = maxOpen;
  }, [maxOpen]);
  // A narrower screen shows fewer windows; the rest wait in the avatar row.
  const shown = state.open.slice(-maxOpen);
  const parked = [...state.open.slice(0, Math.max(0, state.open.length - maxOpen)).reverse(), ...state.heads];

  const show = useCallback((id: number) => {
    setState((s) => {
      // Already open (maybe hidden on a narrow screen)? Bring it to the visible end.
      let open = s.open.slice(-maxRef.current).includes(id) ? s.open : [...s.open.filter((o) => o !== id), id];
      let heads = s.heads.filter((h) => h !== id);
      while (open.length > maxRef.current) {
        heads = [open[0], ...heads];
        open = open.slice(1);
      }
      return { open, heads, minimized: s.minimized.filter((m) => m !== id) };
    });
  }, []);

  const openChat = useCallback(
    (userId: number) => {
      if (!isDesktop) router.push(`/chat/dm/${userId}`);
      else show(userId);
    },
    [isDesktop, router, show],
  );

  const openRandom = useCallback(() => {
    if (!isDesktop) router.push("/chat/stranger");
    else show(RANDOM_WINDOW);
  }, [isDesktop, router, show]);

  const close = useCallback((id: number) => {
    setState((s) => {
      const open = s.open.filter((o) => o !== id);
      const heads = s.heads.filter((h) => h !== id);
      if (heads.length && open.length < maxRef.current) open.unshift(heads.shift()!);
      return { open, heads, minimized: s.minimized.filter((m) => m !== id) };
    });
  }, []);

  const toggleMin = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      minimized: s.minimized.includes(id) ? s.minimized.filter((m) => m !== id) : [...s.minimized, id],
    }));
  }, []);

  const value = useMemo(
    () => ({ openChat, openRandom, isDesktop, parked: isDesktop ? parked : [] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parked` follows state and maxOpen
    [openChat, openRandom, isDesktop, state, maxOpen],
  );

  return (
    <DockContext.Provider value={value}>
      {children}
      {isDesktop && <Dock state={{ ...state, open: shown }} onClose={close} onToggleMin={toggleMin} />}
    </DockContext.Provider>
  );
}

function Dock({
  state,
  onClose,
  onToggleMin,
}: {
  state: DockState;
  onClose: (id: number) => void;
  onToggleMin: (id: number) => void;
}) {
  const pathname = usePathname();
  const { phase, leave, cancel } = useStranger();


  const windows = state.open.filter((id) =>
    // The same chat open as a full page doesn't also need a window.
    id === RANDOM_WINDOW ? pathname !== "/chat/stranger" : pathname !== `/chat/dm/${id}`,
  );
  if (!windows.length) return null;

  return (
    <div className="dock" aria-label="Open chats">
      {windows.map((id) =>
        id === RANDOM_WINDOW ? (
          <StrangerWindow
            key="random"
            win={{
              minimized: state.minimized.includes(id),
              onToggleMin: () => onToggleMin(id),
              onClose: () => {
                // Closing the window ends the random chat (or stops looking).
                if (phase === "chatting") leave();
                else if (phase === "searching") cancel();
                onClose(id);
              },
            }}
          />
        ) : (
          <DmConversation
            key={id}
            userId={id}
            variant="window"
            minimized={state.minimized.includes(id)}
            onToggleMin={() => onToggleMin(id)}
            onClose={() => onClose(id)}
          />
        ),
      )}
    </div>
  );
}
