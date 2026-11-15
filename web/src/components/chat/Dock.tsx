"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useChat } from "./ChatProvider";
import DmConversation from "./DmConversation";
import { Avatar } from "./bits";

/**
 * Floating chat windows, laptop only (1280 px and wider). Up to MAX_OPEN windows dock at the
 * bottom right; opening one more turns the oldest into a round "chat head". On smaller screens
 * openChat() simply navigates to the full-screen chat.
 */
const MAX_OPEN = 3;

type DockValue = {
  openChat: (userId: number) => void;
  isDesktop: boolean;
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

  const openChat = useCallback(
    (userId: number) => {
      if (!isDesktop) {
        router.push(`/chat/dm/${userId}`);
        return;
      }
      setState((s) => {
        let open = s.open.includes(userId) ? s.open : [...s.open, userId];
        let heads = s.heads.filter((id) => id !== userId);
        if (open.length > MAX_OPEN) {
          heads = [open[0], ...heads];
          open = open.slice(1);
        }
        return { open, heads, minimized: s.minimized.filter((id) => id !== userId) };
      });
    },
    [isDesktop, router],
  );

  const close = useCallback((userId: number) => {
    setState((s) => {
      const open = s.open.filter((id) => id !== userId);
      const heads = [...s.heads];
      if (heads.length && open.length < MAX_OPEN) open.unshift(heads.shift()!);
      return { open, heads, minimized: s.minimized.filter((id) => id !== userId) };
    });
  }, []);

  const toggleMin = useCallback((userId: number) => {
    setState((s) => ({
      ...s,
      minimized: s.minimized.includes(userId) ? s.minimized.filter((id) => id !== userId) : [...s.minimized, userId],
    }));
  }, []);

  const value = useMemo(() => ({ openChat, isDesktop }), [openChat, isDesktop]);

  return (
    <DockContext.Provider value={value}>
      {children}
      {isDesktop && <Dock state={state} onOpen={openChat} onClose={close} onToggleMin={toggleMin} />}
    </DockContext.Provider>
  );
}

function Dock({
  state,
  onOpen,
  onClose,
  onToggleMin,
}: {
  state: DockState;
  onOpen: (id: number) => void;
  onClose: (id: number) => void;
  onToggleMin: (id: number) => void;
}) {
  const pathname = usePathname();
  const { friends, conversations, unread } = useChat();
  const nameOf = (id: number) =>
    friends.find((f) => f.user.id === id)?.user.nickname ??
    conversations.find((c) => c.user.id === id)?.user.nickname ??
    "Chat";

  if (!state.open.length && !state.heads.length) return null;

  return (
    <div className="dock" aria-label="Open chats">
      {state.heads.length > 0 && (
        <div className="dock-heads">
          {state.heads.map((id) => (
            <button key={id} type="button" className="dock-head" onClick={() => onOpen(id)} title={`Open chat with ${nameOf(id)}`}>
              <Avatar name={nameOf(id)} size={46} />
              {unread[id] ? <span className="badge">{unread[id]}</span> : null}
            </button>
          ))}
        </div>
      )}
      {state.open
        // The same chat open as a full page doesn't also need a window.
        .filter((id) => pathname !== `/chat/dm/${id}`)
        .map((id) => (
          <DmConversation
            key={id}
            userId={id}
            variant="window"
            minimized={state.minimized.includes(id)}
            onToggleMin={() => onToggleMin(id)}
            onClose={() => onClose(id)}
          />
        ))}
    </div>
  );
}
