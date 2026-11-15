"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ADS_ON } from "@/lib/ads";
import { usePlus } from "@/lib/plus";
import { Icon } from "./bits";

/**
 * Blocks the chat app (never the public pages) for visitors whose browser blocks our ads.
 * Two independent checks must both fail, so a slow network never triggers it:
 *   1. a bait element with ad-like class names that blockers hide
 *   2. /ads.js, a file blockers refuse to load
 * Plus members never see it; the Me screen stays reachable so people can go ad-free.
 * Enabled with NEXT_PUBLIC_ADBLOCK_WALL=on (and only while ads are on).
 */
const WALL_ON = ADS_ON && process.env.NEXT_PUBLIC_ADBLOCK_WALL === "on";

declare global {
  interface Window {
    __vchatAdProbe?: boolean;
  }
}

function baitHidden(): Promise<boolean> {
  return new Promise((resolve) => {
    const bait = document.createElement("div");
    bait.className = "adsbox ad-banner pub_300x250 text-ad textAd banner-ads";
    bait.setAttribute("aria-hidden", "true");
    bait.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:2px;height:2px;";
    bait.innerHTML = "&nbsp;";
    document.body.appendChild(bait);
    setTimeout(() => {
      const style = getComputedStyle(bait);
      const hidden = bait.offsetHeight === 0 || style.display === "none" || style.visibility === "hidden";
      bait.remove();
      resolve(hidden);
    }, 400);
  });
}

function scriptBlocked(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.__vchatAdProbe) return resolve(false);
    const s = document.createElement("script");
    s.src = `/ads.js?v=${Date.now()}`;
    s.async = true;
    s.onload = () => resolve(!window.__vchatAdProbe);
    s.onerror = () => resolve(true);
    document.head.appendChild(s);
    setTimeout(() => resolve(!window.__vchatAdProbe), 4000);
  });
}

export default function AdblockWall() {
  const pathname = usePathname();
  const plus = usePlus();
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!WALL_ON) return;
    let cancelled = false;
    Promise.all([baitHidden(), scriptBlocked()]).then(([bait, script]) => {
      if (!cancelled) setBlocked(bait && script);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!WALL_ON || !blocked || plus || pathname === "/chat/me") return null;

  return (
    <div className="adwall" role="dialog" aria-modal="true" aria-labelledby="adwall-title">
      <div className="adwall-card">
        <span className="adwall-icon">
          <Icon name="shield" size={30} />
        </span>
        <h2 id="adwall-title">vChat is free because of ads</h2>
        <p>Your browser is blocking them. Allow ads on vChat to keep chatting, or go ad-free with Plus.</p>
        <ol className="adwall-steps">
          <li>Tap your ad blocker&apos;s icon (uBlock, AdBlock, Brave Shields…)</li>
          <li>Choose &ldquo;Pause on this site&rdquo; or &ldquo;Don&apos;t run on this site&rdquo;</li>
          <li>Tap Reload below</li>
        </ol>
        <button type="button" className="start-btn wide" onClick={() => window.location.reload()}>
          I&apos;ve allowed ads · Reload
        </button>
        <Link href="/chat/me#plus" className="pill-btn">
          Go ad-free with Plus
        </Link>
      </div>
    </div>
  );
}
