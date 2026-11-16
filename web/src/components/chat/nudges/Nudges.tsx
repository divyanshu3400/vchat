"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { countVisit, isEngaged, snooze, snoozed, useInstall } from "@/lib/install";
import { useChat } from "../ChatProvider";
import { Icon } from "../bits";
import IosInstallGuide from "./IosInstallGuide";

const subscribeNothing = () => () => undefined;

/**
 * One small card at a time, never on the first visit and never over a conversation:
 * first "add vChat to your home screen", later "turn on notifications". "Not now" hides a card
 * for 14 days. Shown on the list screens only (home, rooms, chats, me).
 */
export default function Nudges({ enabled }: { enabled: boolean }) {
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return mounted && enabled ? <NudgeCards /> : null;
}

function NudgeCards() {
  const { push, me } = useChat();
  const { info, canPrompt, prompt } = useInstall();
  const [visits] = useState(countVisit);
  const [engaged, setEngaged] = useState(isEngaged);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    const on = () => setEngaged(true);
    window.addEventListener("vchat-engaged", on);
    return () => window.removeEventListener("vchat-engaged", on);
  }, []);

  if (!me || !info) return null;
  const ready = engaged || visits >= 2;
  const canInstall = canPrompt || info.platform === "ios" || info.inApp;
  const showInstall = ready && !info.installed && canInstall && !closed.install && !snoozed("install");
  const showPush =
    !showInstall && engaged && push.state === "default" && !!push.info?.enabled && !closed.push && !snoozed("push");

  const dismiss = (name: string) => {
    snooze(name);
    setClosed((c) => ({ ...c, [name]: true }));
  };

  if (showInstall) {
    return (
      <>
        <aside className="nudge" aria-label="Install vChat">
          <span className="nudge-icon" aria-hidden="true">
            📲
          </span>
          <div className="nudge-text">
            <b>Get vChat on your home screen</b>
            <span>
              {info.inApp
                ? "This app's browser can't install it. Open this page in Chrome or Safari."
                : "Opens like an app, and friends can reach you with notifications."}
            </span>
          </div>
          <div className="nudge-actions">
            {!info.inApp && (
              <button
                type="button"
                className="pill-btn primary"
                onClick={async () => {
                  if (info.platform === "ios") setGuide(true);
                  else if (await prompt()) setClosed((c) => ({ ...c, install: true }));
                }}
              >
                Install
              </button>
            )}
            <button type="button" className="pill-btn" onClick={() => dismiss("install")}>
              Not now
            </button>
          </div>
        </aside>
        {guide && (
          <IosInstallGuide
            notSafari={info.iosNotSafari}
            onClose={() => {
              setGuide(false);
              dismiss("install");
            }}
          />
        )}
      </>
    );
  }

  if (showPush) {
    return (
      <aside className="nudge" aria-label="Turn on notifications">
        <span className="nudge-icon" aria-hidden="true">
          <Icon name="bell" size={22} />
        </span>
        <div className="nudge-text">
          <b>Know when friends message you?</b>
          <span>Only friends&apos; messages, friend requests and missed calls. Change it any time in Me.</span>
        </div>
        <div className="nudge-actions">
          <button
            type="button"
            className="pill-btn primary"
            disabled={push.busy}
            onClick={async () => {
              await push.enable();
              setClosed((c) => ({ ...c, push: true }));
            }}
          >
            Turn on
          </button>
          <button type="button" className="pill-btn" onClick={() => dismiss("push")}>
            Not now
          </button>
        </div>
      </aside>
    );
  }
  return null;
}
