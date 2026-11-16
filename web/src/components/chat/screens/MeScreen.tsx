"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import CloseAccountSheet from "@/components/account/CloseAccountSheet";
import { updateMe } from "@/lib/api";
import { useChat } from "../ChatProvider";
import { ChatHeader } from "../ChatShell";
import { Avatar, Icon } from "../bits";
import { cleanWordsOn, setCleanWords } from "../messages/richText";
import AppSettings from "../nudges/AppSettings";

const GENDER: Record<string, string> = { M: "Man", F: "Woman", O: "Other" };

export default function MeScreen() {
  const router = useRouter();
  const { me, friends, premium, askAccount, getAccess } = useChat();
  const [closing, setClosing] = useState<"deactivate" | "delete" | null>(null);
  const [lastSeenOn, setLastSeenOn] = useState<boolean | null>(null);
  const showLastSeen = lastSeenOn ?? me?.show_last_seen !== false;

  async function toggleLastSeen(on: boolean) {
    setLastSeenOn(on);
    try {
      const updated = await updateMe({ show_last_seen: on }, await getAccess());
      setLastSeenOn(updated.show_last_seen !== false);
    } catch {
      setLastSeenOn(!on);
    }
  }
  const guest = me?.is_guest !== false;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clean, setClean] = useState(() => (typeof window === "undefined" ? true : cleanWordsOn()));

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
              {guest ? "Guest" : "Saved account"}
              {me?.gender ? ` · ${GENDER[me.gender] ?? ""}` : ""} · {friends.length} {friends.length === 1 ? "friend" : "friends"}
            </p>
          </div>
        </section>

        {me && guest ? (
          <section className="save-card" aria-labelledby="save-title">
            <h2 id="save-title">Don&apos;t lose {me.nickname}</h2>
            <p>
              Right now this account lives only in this browser. Save it with your email and a password to keep your friends
              and chats, make new friends, and log in on any device.
            </p>
            <button type="button" className="start-btn wide" onClick={() => askAccount()}>
              Save my account
            </button>
          </section>
        ) : (
          me && (
            <section className="settings" aria-label="Account">
              <div className="setting">
                <span>
                  <b>Signed in as</b>
                  <small>{me.email}</small>
                </span>
                <span className="tag">Verified</span>
              </div>
            </section>
          )
        )}

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

        <AppSettings />

        <section className="settings" aria-label="Settings">
          <div className="setting">
            <span>
              <b>Light or dark</b>
              <small>Follows your phone until you choose</small>
            </span>
            <ThemeToggle />
          </div>
          <label className="setting">
            <span>
              <b>Show my last seen</b>
              <small>Friends see when you were last online. Turn it off and you won&apos;t see theirs either.</small>
            </span>
            <input type="checkbox" className="switch" checked={showLastSeen} onChange={(e) => toggleLastSeen(e.target.checked)} />
          </label>
          <label className="setting">
            <span>
              <b>Hide swear words</b>
              <small>Shows f••• instead, in every chat on this device</small>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={clean}
              suppressHydrationWarning
              onChange={(e) => {
                setClean(e.target.checked);
                setCleanWords(e.target.checked);
              }}
            />
          </label>
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
              {guest ? "Leave vChat on this browser" : "Log out"}
            </button>
          ) : (
            <div className="confirm-bar inline">
              <span>
                {guest ? (
                  <>
                    You&apos;re a guest: leaving loses <b>{me?.nickname}</b> and your friends for good. Save your account first to
                    keep them.
                  </>
                ) : (
                  <>Log out on this device? Log back in any time with {me?.email}.</>
                )}
              </span>
              <button type="button" className="pill-btn danger" onClick={leave} disabled={busy}>
                {busy ? "Leaving…" : guest ? "Leave" : "Log out"}
              </button>
              <button type="button" className="pill-btn" onClick={() => setConfirmLeave(false)}>
                Stay
              </button>
            </div>
          )}
        </section>

        {me && (
          <section className="settings account-close" aria-labelledby="close-title-h">
            <h2 id="close-title-h" className="settings-title">
              Close your account
            </h2>
            {!guest && (
              <button type="button" className="setting link" onClick={() => setClosing("deactivate")}>
                <span>
                  <b>Deactivate account</b>
                  <small>Take a break. Log in again any time to come back.</small>
                </span>
                <Icon name="lock" size={18} />
              </button>
            )}
            <button type="button" className="setting link danger-row" onClick={() => setClosing("delete")}>
              <span>
                <b>Delete account</b>
                <small>{guest ? "Deleted right away. Guest accounts can't be recovered." : "Deleted after 15 days. Log in before then to cancel."}</small>
              </span>
              <Icon name="trash" size={18} />
            </button>
          </section>
        )}
        {closing && me && (
          <CloseAccountSheet
            kind={closing}
            guest={guest}
            nickname={me.nickname}
            getAccess={getAccess}
            onClose={() => setClosing(null)}
            // Signed out by the server: start over on the front page.
            onDone={() => window.location.replace("/")}
          />
        )}
      </div>
    </div>
  );
}
