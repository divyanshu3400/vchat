import Link from "next/link";
import SharedAdSlot from "./AdSlot";
import { OnlineTotal } from "./LiveCounts";
import ThemeToggle from "./ThemeToggle";
import { SEARCH_PAGES } from "@/lib/searchPages";

export function Logo() {
  return (
    <Link className="logo" href="/" aria-label="vChat home">
      {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
      <img src="/brand/logo-mark.png" alt="" width={42} height={34} />
      <span>
        <i>V</i>Chat
      </span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="glow" aria-hidden="true" />
      <div className="wrap nav">
        <Logo />
        <ul>
          <li><Link href="/#rooms">Rooms</Link></li>
          <li><Link href="/#how">How it works</Link></li>
          <li><Link href="/#features">Features</Link></li>
          <li><Link href="/#faq">FAQ</Link></li>
        </ul>
        <div className="nav-right">
          <OnlineTotal />
          <ThemeToggle />
          <Link className="nav-cta" href="/#join">Start chatting</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap foot">
        <span>© {new Date().getFullYear()} vChat · Free chat rooms · 18+ only</span>
        <ul>
          <li><Link href="/about">About</Link></li>
          <li><Link href="/safety">Safety</Link></li>
          <li><Link href="/rules">Chat rules</Link></li>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/terms">Terms</Link></li>
          <li><Link href="/report">Report abuse</Link></li>
          <li><Link href="/contact">Contact</Link></li>
        </ul>
        <nav className="foot-popular" aria-label="Popular">
          {SEARCH_PAGES.map((p) => (
            <Link key={p.slug} href={`/${p.slug}`}>
              {p.h1}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

/** Public pages' ad: a 300×250 box that fits phones and laptops. Hidden while ads are off. */
export function AdSlot() {
  return <SharedAdSlot kind="rect" className="page-ad" />;
}
