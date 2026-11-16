"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AdSlot from "@/components/AdSlot";
import ThemeToggle from "@/components/ThemeToggle";
import { ADS_ON } from "@/lib/ads";
import { usePlus } from "@/lib/plus";
import AdblockWall from "./AdblockWall";
import CallProvider from "./calls/CallProvider";
import CallScreen from "./calls/CallScreen";
import { useChat } from "./ChatProvider";
import ConversationList from "./ConversationList";
import { DockProvider, useDock } from "./Dock";
import { Icon } from "./bits";
import StrangerProvider, { useStranger } from "./stranger/StrangerProvider";
import MessageBanner from "./nudges/MessageBanner";
import Nudges from "./nudges/Nudges";
import SoundEffects from "./nudges/SoundEffects";

/** Screens reached from the tab bar. Everything else under /chat is a conversation. */
const TAB_SCREENS = new Set(["/chat", "/chat/rooms", "/chat/stranger", "/chat/inbox", "/chat/me"]);

const NAV = [
  { href: "/chat", label: "Home", icon: "home" },
  { href: "/chat/rooms", label: "Rooms", icon: "hash" },
  { href: "/chat/stranger", label: "Random", icon: "shuffle", primary: true },
  { href: "/chat/inbox", label: "Chats", icon: "chat", phoneOnly: true },
  { href: "/chat/me", label: "Me", icon: "me" },
] as const;

/** True while a text field has focus: the phone keyboard is (almost always) up. */
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "checkbox"));
    const onIn = (e: FocusEvent) => isField(e.target) && setTyping(true);
    const onOut = (e: FocusEvent) => isField(e.target) && setTyping(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);
  // The app is as tall as what is visible above the keyboard (iPhones don't shrink the page
  // themselves), so the message box sits right on top of the keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const fit = () => {
      root.style.setProperty("--app-h", `${Math.round(vv.height)}px`);
      if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      root.style.removeProperty("--app-h");
    };
  }, []);
  return typing;
}

export function ChatHeader({
  title,
  subtitle,
  actions,
  back,
  backBadge = 0,
  avatar,
  onTitleClick,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Where the phone's back arrow goes. Hidden on wider screens, where the list is always visible. */
  back?: string;
  /** Unread messages in other chats, shown on the back arrow. */
  backBadge?: number;
  avatar?: React.ReactNode;
  /** Conversations: tapping the name opens the person's card. */
  onTitleClick?: () => void;
}) {
  // A conversation (it has an avatar) keeps its bar for the person and the calls; the
  // light/dark switch lives on the list screens and in Me.
  const conversation = !!avatar;
  const who = (
    <>
      {avatar}
      <div className="screen-title">
        <h1>{title}</h1>
        {subtitle && (
          <span className="screen-sub" role="status">
            {subtitle}
          </span>
        )}
      </div>
    </>
  );
  return (
    <header className={`screen-head${conversation ? " convo-head" : ""}`}>
      {back && (
        <Link href={back} className="icon-btn back-btn" aria-label={backBadge ? `Back, ${backBadge} unread` : "Back"}>
          <Icon name="back" />
          {backBadge > 0 && <b className="back-badge">{backBadge > 99 ? "99+" : backBadge}</b>}
        </Link>
      )}
      {onTitleClick ? (
        <button type="button" className="head-who" onClick={onTitleClick} aria-label={`About ${title}`}>
          {who}
        </button>
      ) : (
        <div className="head-who">{who}</div>
      )}
      <div className="screen-actions">
        {actions}
        {!conversation && <ThemeToggle />}
      </div>
    </header>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/chat" ? pathname === "/chat" : pathname.startsWith(href);
}

/** A live random chat while you're on another screen: a dot on the Random tab. */
function useStrangerLive(pathname: string) {
  const { phase } = useStranger();
  return pathname !== "/chat/stranger" && (phase === "chatting" || phase === "searching");
}

function Rail({ pathname }: { pathname: string }) {
  const strangerLive = useStrangerLive(pathname);
  const { isDesktop, openRandom } = useDock();
  return (
    <nav className="rail" aria-label="Main">
      <Link href="/" className="rail-logo" aria-label="vChat home page">
        {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
        <img src="/brand/logo-mark.png" alt="" width={44} height={36} />
      </Link>
      {NAV.filter((n) => !("phoneOnly" in n)).map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`rail-item${isActive(pathname, n.href) ? " on" : ""}`}
          onClick={(e) => {
            // Laptops: random chat opens as a window next to the others.
            if (n.href === "/chat/stranger" && isDesktop && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              openRandom();
            }
          }}
        >
          <span className="tab-icon">
            <Icon name={n.icon} size={22} />
            {n.href === "/chat/stranger" && strangerLive && <span className="live-ping" aria-label="Random chat in progress" />}
          </span>
          <span>{n.label}</span>
        </Link>
      ))}
      <span className="rail-grow" />
      <Link href="/chat/me#plus" className="rail-item plus">
        <Icon name="crown" size={22} />
        <span>Plus</span>
      </Link>
    </nav>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  const { unread, incoming } = useChat();
  const strangerLive = useStrangerLive(pathname);
  const waiting = Object.values(unread).reduce((a, b) => a + b, 0) + incoming.length;
  return (
    <nav className="tabbar" aria-label="Main">
      {NAV.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className={`tab${isActive(pathname, n.href) ? " on" : ""}${"primary" in n ? " primary" : ""}`}
          aria-current={isActive(pathname, n.href) ? "page" : undefined}
        >
          <span className="tab-icon">
            <Icon name={n.icon} size={"primary" in n ? 24 : 22} />
            {n.href === "/chat/inbox" && waiting > 0 && <span className="badge">{waiting > 99 ? "99+" : waiting}</span>}
            {n.href === "/chat/stranger" && strangerLive && <span className="live-ping" aria-label="Random chat in progress" />}
          </span>
          <span className="tab-label">{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * Phone (< 768 px): one screen at a time, tab bar at the bottom, anchor ad above it.
 * Tablet (768–1279 px): icon rail + conversation list + the screen.
 * Laptop (1280 px +): the same, plus a 300×600 ad rail and floating chat windows.
 */
export default function ChatShell({ children }: { children: React.ReactNode }) {
  return (
    // The floating chat windows (DockProvider renders them) have call buttons, so they live
    // inside CallProvider; calls in turn follow the random chat.
    <StrangerProvider>
      <CallProvider>
        <DockProvider>
          <Frame>{children}</Frame>
          <CallScreen />
        </DockProvider>
      </CallProvider>
    </StrangerProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const typing = useTyping();
  const { phase } = useStranger();
  const plus = usePlus();
  // A random chat in progress takes the whole phone screen, like any other conversation.
  const strangerChat = pathname === "/chat/stranger" && (phase === "chatting" || phase === "ended");
  const inConversation = !TAB_SCREENS.has(pathname) || strangerChat;
  const adsShown = ADS_ON && !plus;

  return (
    <>
      <AdblockWall />
      <div className={`app${inConversation ? " in-conversation" : ""}${typing ? " kb-open" : ""}${adsShown ? " ads-on" : ""}`}>
        <Rail pathname={pathname} />
        <aside className="list-pane" aria-label="Conversations">
          <ConversationList />
        </aside>
        <main className="screen">{children}</main>
        <aside className="ad-rail" aria-label="Advertisement">
          <AdSlot kind="sky" />
        </aside>
        {!inConversation && <AdSlot kind="anchor" className="phone-anchor" />}
        {!inConversation && <TabBar pathname={pathname} />}
      </div>
      <Nudges enabled={!inConversation} />
      <MessageBanner />
      <SoundEffects />
    </>
  );
}
