"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { Avatar, Icon } from "../bits";

const GENDER: Record<string, string> = { M: "Man", F: "Woman", O: "Other" };

export default function MeScreen() {
  const router = useRouter();
  const { me, friends, premium } = useChat();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);

  async function leave() {
    setBusy(true);
    await fetch("/api/auth/logout/", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    router.replace("/");
  }

  return (
    <div className="page-screen">
      <ChatHeader title="Me" />
      <div className="page-scroll">
        <section className="profile-card">
          {me && <Avatar name={me.nickname} size={72} />}
          <div>
            <h2>{me?.nickname ?? "…"}</h2>
            <p className="muted-text">
              Guest{me?.gender ? ` · ${GENDER[me.gender] ?? ""}` : ""} · {friends.length} {friends.length === 1 ? "friend" : "friends"}
            </p>
          </div>
        </section>

        <section className={`plus-card${premium?.plus ? " active" : ""}`} id="plus" aria-labelledby="plus-title">
          <div className="plus-head">
            <span className="plus-icon">
              <Icon name="crown" size={24} />
            </span>
            <div>
              <h2 id="plus-title">vChat Plus</h2>
              <p>
                {premium?.plus && premium.plus_until
                  ? `Active until ${new Date(premium.plus_until).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}. Thanks for supporting vChat.`
                  : "Chat the way you like, without ads."}
              </p>
            </div>
          </div>
          <ul className="plus-perks">
            <li>No ads anywhere</li>
            <li>Women-only or men-only matching, always</li>
            <li>Photos and videos with strangers</li>
            <li>Rematch a stranger you skipped by mistake</li>
            <li>Plus badge and faster matching</li>
          </ul>
          {!premium?.plus && (
            <>
              <div className="plans-row">
                <div className="plan-opt">
                  <b>₹99</b>
                  <small>per month</small>
                </div>
                <div className="plan-opt best">
                  <b>₹699</b>
                  <small>per year · save 41%</small>
                </div>
              </div>
              <button type="button" className="start-btn wide" disabled>
                Payments open soon
              </button>
              <p className="muted-text small">UPI, cards and wallets in India; cards worldwide. Cancel anytime.</p>
            </>
          )}
          {!premium?.plus && premium?.grants.gender_filter && (
            <p className="perk-line">
              Unlocked with an ad: women/men-only matching, {premium.grants.gender_filter.uses_left} chats left
            </p>
          )}
        </section>

        <section className="settings" aria-label="Settings">
          <div className="setting">
            <span>
              <b>Light or dark</b>
              <small>Follows your phone until you choose</small>
            </span>
            <ThemeToggle />
          </div>
          <div className="setting">
            <span>
              <b>Keep your friends on other devices</b>
              <small>Save this profile with Google. Coming soon.</small>
            </span>
          </div>
          <Link className="setting link" href="/#faq">
            <span>
              <b>Help and safety</b>
              <small>How vChat works, rules, reporting</small>
            </span>
            <Icon name="back" size={18} />
          </Link>
        </section>

        <section className="danger-zone">
          {!confirmLeave ? (
            <button type="button" className="pill-btn" onClick={() => setConfirmLeave(true)}>
              Leave vChat on this browser
            </button>
          ) : (
            <div className="confirm-bar inline">
              <span>
                You&apos;re a guest: leaving deletes access to <b>{me?.nickname}</b> and your friends on this browser for good.
              </span>
              <button type="button" className="pill-btn danger" onClick={leave} disabled={busy}>
                {busy ? "Leaving…" : "Leave"}
              </button>
              <button type="button" className="pill-btn" onClick={() => setConfirmLeave(false)}>
                Stay
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
