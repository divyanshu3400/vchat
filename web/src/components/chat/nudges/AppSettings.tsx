"use client";

import { useState } from "react";
import { useInstall } from "@/lib/install";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";
import IosInstallGuide from "./IosInstallGuide";
import { inAppAlertsOn, setInAppAlerts } from "./MessageBanner";

/** Me screen: install the app, and everything about notifications on this device. */
export default function AppSettings() {
  const { push, me } = useChat();
  const { info, canPrompt, prompt } = useInstall();
  const [guide, setGuide] = useState(false);
  const [alerts, setAlerts] = useState(() => (typeof window === "undefined" ? true : inAppAlertsOn()));
  const prefs = push.info?.prefs;
  const on = push.state === "granted" && (push.info?.devices ?? 0) > 0;

  return (
    <section className="settings" aria-labelledby="app-title">
      <h2 id="app-title" className="settings-title">
        App &amp; notifications
      </h2>

      <div className="setting">
        <span>
          <b>vChat app</b>
          <small>
            {info?.installed
              ? "Installed on this device."
              : info?.inApp
                ? "Open vChat in Chrome or Safari to install it."
                : "Add vChat to your home screen. It opens like an app."}
          </small>
        </span>
        {info?.installed ? (
          <span className="tag">Installed</span>
        ) : (
          !info?.inApp &&
          (canPrompt || info?.platform === "ios") && (
            <button type="button" className="pill-btn primary" onClick={() => (info?.platform === "ios" ? setGuide(true) : prompt())}>
              <Icon name="phoneapp" size={15} /> Install
            </button>
          )
        )}
      </div>

      <div className="setting">
        <span>
          <b>Notifications</b>
          <small>
            {push.state === "needs-install"
              ? "On iPhone, add vChat to your Home Screen first (iOS 16.4 or newer), then turn them on there."
              : push.state === "unsupported"
                ? "This browser can't show vChat notifications."
                : push.state === "denied"
                  ? "Blocked in your browser. Tap the lock (or ⓘ) next to the address, open Permissions or Site settings, and allow Notifications."
                  : on
                    ? "On for this device, when vChat isn't open on your screen."
                    : "Friends' messages, friend requests and missed calls, even when vChat is closed."}
          </small>
        </span>
        {push.state === "needs-install" ? (
          <button type="button" className="pill-btn primary" onClick={() => setGuide(true)}>
            How
          </button>
        ) : push.state === "default" || (push.state === "granted" && !on) ? (
          <button type="button" className="pill-btn primary" disabled={push.busy || !push.info?.enabled} onClick={() => push.enable()}>
            Turn on
          </button>
        ) : on ? (
          <button type="button" className="pill-btn" disabled={push.busy} onClick={() => push.disable()}>
            Turn off
          </button>
        ) : null}
      </div>

      {on && prefs && (
        <>
          {(
            [
              ["messages", "Messages from friends", "One notification per chat, updated as messages arrive"],
              ["requests", "Friend requests", "When someone wants to be friends, or accepts you"],
              ["calls", "Missed calls", "When a friend calls and you don't pick up"],
              ["preview", "Show message text", "Off: “New message from Asha” without the words"],
            ] as const
          ).map(([key, label, hint]) => (
            <label className="setting" key={key}>
              <span>
                <b>{label}</b>
                <small>{hint}</small>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={prefs[key]}
                onChange={(e) => push.setPrefs({ [key]: e.target.checked })}
              />
            </label>
          ))}
          {info?.platform === "android" && (
            <p className="settings-tip">
              Notifications late or missing on Xiaomi, Oppo, Vivo or Realme? In your phone&apos;s settings, set Chrome&apos;s battery
              use to &quot;No restrictions&quot; and allow it to auto-start.
            </p>
          )}
        </>
      )}

      {me?.email && prefs && (
        <label className="setting">
          <span>
            <b>Email notifications</b>
            <small>Emails to {me.email} about your account, like a scheduled deletion</small>
          </span>
          <input type="checkbox" className="switch" checked={prefs.email} onChange={(e) => push.setPrefs({ email: e.target.checked })} />
        </label>
      )}

      <label className="setting">
        <span>
          <b>Alerts inside vChat</b>
          <small>A banner at the top when a friend writes while you&apos;re in another chat</small>
        </span>
        <input
          type="checkbox"
          className="switch"
          checked={alerts}
          suppressHydrationWarning
          onChange={(e) => {
            setAlerts(e.target.checked);
            setInAppAlerts(e.target.checked);
          }}
        />
      </label>

      {guide && <IosInstallGuide notSafari={info?.iosNotSafari} onClose={() => setGuide(false)} />}
    </section>
  );
}
