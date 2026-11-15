import Link from "next/link";
import SharedAdSlot from "./AdSlot";
import { OnlineTotal } from "./LiveCounts";
import ThemeToggle from "./ThemeToggle";

export function Logo() {
  return (
    <Link className="logo" href="/" aria-label="vChat home">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M3 16c3-8 6-8 9 0s6 8 9 0 6-8 8-2" />
      </svg>
      <span>
        <i>v</i>chat
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
        <span>© {new Date().getFullYear()} vChat · Anonymous chat rooms for adults</span>
        {/* TODO: real pages. Privacy, Terms and Report abuse are required before launch and for ad network approval. */}
        <ul>
          <li><Link href="/about">About</Link></li>
          <li><Link href="/rules">Chat rules</Link></li>
          <li><Link href="/privacy">Privacy</Link></li>
          <li><Link href="/terms">Terms</Link></li>
          <li><Link href="/report">Report abuse</Link></li>
          <li><Link href="/contact">Contact</Link></li>
        </ul>
      </div>
    </footer>
  );
}

/** Public pages' ad: a 300×250 box that fits phones and laptops. Hidden while ads are off. */
export function AdSlot() {
  return <SharedAdSlot kind="rect" className="page-ad" />;
}
