import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline", robots: { index: false, follow: false } };

/** Shown by the service worker when the phone has no connection. */
export default function OfflinePage() {
  return (
    <main className="banned-screen">
      <div>
        <h1 style={{ color: "var(--fg)" }}>You&apos;re offline</h1>
        <p>vChat needs the internet to reach your friends. It reconnects by itself as soon as you&apos;re back.</p>
        <p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is the point when offline */}
          <a href="/chat">Try again</a>
        </p>
      </div>
    </main>
  );
}
