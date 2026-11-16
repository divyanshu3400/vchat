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
import SoundSettings from "../nudges/SoundSettings";
import EditProfileSheet from "./EditProfileSheet";
import EmailSettings from "./EmailSettings";

const GENDER: Record<string, string> = { M: "Man", F: "Woman", O: "Other" };

type PrivacyKey = "discoverable" | "show_online" | "show_last_seen" | "read_receipts";
// Give and take, like WhatsApp: hide yours and you don't see other people's either.
const PRIVACY: [PrivacyKey, string, string][] = [
  ["discoverable", "Let people find me by name", "Others can search for you in Chats and send a message request. Off: only friends and random chat."],
  ["show_online", "Show when I'm online", "Off: friends always see you as offline, and you won't see who's online."],
  ["show_last_seen", "Show my last seen", "Friends see when you were last online. Turn it off and you won't see theirs either."],
  ["read_receipts", "Read receipts", "Off: friends don't see when you've read their messages, and you won't see theirs."],
];

export default function MeScreen() {
  const router = useRouter();
  const { me, friends, premium, askAccount, getAccess } = useChat();
  const [closing, setClosing] = useState<"deactivate" | "delete" | null>(null);
  // Privacy switches: what you changed here, else what the server says (all on by default).
  const [privacy, setPrivacy] = useState<Partial<Record<PrivacyKey, boolean>>>({});
  const isOn = (key: PrivacyKey) => privacy[key] ?? me?.[key] !== false;

  async function setPrivacyKey(key: PrivacyKey, on: boolean) {
    setPrivacy((p) => ({ ...p, [key]: on }));
    try {
      const updated = await updateMe({ [key]: on }, await getAccess());
      setPrivacy((p) => ({ ...p, [key]: updated[key] !== false }));
    } catch {
      setPrivacy((p) => ({ ...p, [key]: !on }));
    }
  }
  const guest = me?.is_guest !== false;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [editing, setEditing] = useState(false);
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
          {me && (
            <button type="button" className="profile-avatar" onClick={() => setEditing(true)} aria-label="Edit profile">
              <Avatar id={me.id} name={me.nickname} size={72} />
            </button>
          )}
          <div className="profile-text">
            <h2>{me?.nickname ?? "…"}</h2>
            {me?.handle && <p className="profile-handle">@{me.handle}</p>}
            <p className="muted-text">
              {guest ? "Guest" : "Saved account"}
              {me?.gender ? ` · ${GENDER[me.gender] ?? ""}` : ""} · {friends.length} {friends.length === 1 ? "friend" : "friends"}
            </p>
          </div>
          {me && (
            <button type="button" className="pill-btn profile-edit" onClick={() => setEditing(true)}>
              <Icon name="edit" size={15} /> Edit
            </button>
          )}
        </section>
        {editing && me && <EditProfileSheet me={me} onClose={() => setEditing(false)} />}

        {me && guest ? (
          <section className="save-card" aria-labelledby="save-title">
            <h2 id="save-title">Don&apos;t lose {me.nickname}</h2>
            <p>
              Right now this account lives only in this browser. Save it with a username and a password to keep your friends
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
                  <small>{me.handle ? `@${me.handle}` : me.email}</small>
                </span>
                <span className="tag">Saved</span>
              </div>
            </section>
          )
        )}

        {premium?.free_for_all ? (
          <section className="plus-card active" id="plus" aria-labelledby="plus-title">
            <div className="plus-head">
              <span className="plus-icon">
                <Icon name="crown" size={24} />
              </span>
              <div>
                <h2 id="plus-title">Everything is free</h2>
                <p>vChat is new, so every feature is on for everyone: no ads, no payments.</p>
              </div>
            </div>
            <ul className="plus-perks">
              <li>Women-only or men-only matching</li>
              <li>Photos with strangers</li>
              <li>Voice and video calls with friends</li>
              <li>GIFs, stickers and disappearing photos</li>
            </ul>
          </section>
        ) : (
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
        )}

        {me && !guest && <EmailSettings me={me} />}

        <AppSettings />

        <SoundSettings />

        <section className="settings" aria-label="Settings">
          <div className="setting">
            <span>
              <b>Light or dark</b>
              <small>Follows your phone until you choose</small>
            </span>
            <ThemeToggle />
          </div>
          {PRIVACY.map(([key, label, hint]) => (
            <label className="setting" key={key}>
              <span>
                <b>{label}</b>
                <small>{hint}</small>
              </span>
              <input type="checkbox" className="switch" checked={isOn(key)} onChange={(e) => setPrivacyKey(key, e.target.checked)} />
            </label>
          ))}
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
                  <>Log out on this device? Log back in any time with {me?.handle ? `@${me.handle}` : me?.email} and your password.</>
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
