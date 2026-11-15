"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ADS_MODE, ADS_ON } from "@/lib/ads";
import { ApiError, claimReward, type RewardKind } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";

const COPY: Record<RewardKind, { title: string; reward: string }> = {
  gender_filter: { title: "Choose who you meet", reward: "Women-only or men-only matching for 15 chats (2 hours)" },
  random_photos: { title: "Send photos to strangers", reward: "3 photos in the next 30 minutes" },
};
const AD_SECONDS = 15;

/**
 * The rewarded ad itself. In "placeholder" mode it is a timed stand-in so the whole flow can be
 * tried; in "live" mode the ad network's rewarded slot replaces it (Google Ad Manager web rewarded
 * ads report "granted" to the page, which then claims the reward from our API).
 */
function RewardedAd({ onFinished, onCancel }: { onFinished: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(AD_SECONDS);
  useEffect(() => {
    if (left <= 0) {
      onFinished();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onFinished]);

  return (
    <div className="rewarded" role="dialog" aria-label="Rewarded ad">
      <div className="rewarded-top">
        <span className="kicker">Ad · reward in {left}s</span>
        <button type="button" className="pill-btn" onClick={onCancel}>
          Close (no reward)
        </button>
      </div>
      <div className="rewarded-stage">
        {ADS_MODE === "placeholder" ? <span>Rewarded video ad</span> : null}
      </div>
      <div className="rewarded-bar" style={{ width: `${((AD_SECONDS - left) / AD_SECONDS) * 100}%` }} />
    </div>
  );
}

export default function UnlockSheet({
  kind,
  onUnlocked,
  onClose,
}: {
  kind: RewardKind;
  onUnlocked: () => void;
  onClose: () => void;
}) {
  const { premium, setPremium, getAccess } = useChat();
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState("");
  const canWatch = ADS_ON && !!premium?.rewarded_ads;
  const copy = COPY[kind];

  async function finished() {
    setWatching(false);
    try {
      const res = await claimReward(kind, await getAccess());
      setPremium(res.status);
      onUnlocked();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't unlock it. Try again.");
    }
  }

  if (watching) return <RewardedAd onFinished={finished} onCancel={() => setWatching(false)} />;

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={copy.title}>
      <button type="button" className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <span className="sheet-grab" aria-hidden="true" />
        <h2>{copy.title}</h2>
        <p className="muted-text">Pick one. Free features stay free either way.</p>
        {canWatch && (
          <button type="button" className="sheet-opt" onClick={() => { setError(""); setWatching(true); }}>
            <span className="sheet-ic reward">
              <Icon name="play" size={20} />
            </span>
            <span>
              <b>Watch a short ad</b>
              <small>{copy.reward}</small>
            </span>
          </button>
        )}
        <Link href="/chat/me#plus" className="sheet-opt" onClick={onClose}>
          <span className="sheet-ic plus">
            <Icon name="crown" size={20} />
          </span>
          <span>
            <b>vChat Plus · ₹99 / month</b>
            <small>Filters always on, no ads anywhere, photos with strangers</small>
          </span>
        </Link>
        {error && <p className="chat-notice">{error}</p>}
        <button type="button" className="pill-btn" onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
