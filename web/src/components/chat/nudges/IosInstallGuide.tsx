"use client";

import { SITE } from "@/lib/site";

/** iPhone has no install button for websites: three steps in Safari instead. */
export default function IosInstallGuide({ notSafari, onClose }: { notSafari?: boolean; onClose: () => void }) {
  return (
    <div className="msg-sheet-veil" onClick={onClose}>
      <div className="account-sheet ios-guide" role="dialog" aria-label="Add vChat to your Home Screen" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="account-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="account-badge" aria-hidden="true">
          📲
        </div>
        <h2>Add vChat to your Home Screen</h2>
        {notSafari ? (
          <p className="account-why">
            On iPhone only <b>Safari</b> can add apps to the Home Screen. Open <b>{SITE.url.replace(/^https?:\/\//, "")}</b> in Safari, then follow
            these steps.
          </p>
        ) : (
          <p className="account-why">It opens full screen like an app, and lets your friends reach you with notifications.</p>
        )}
        <ol className="ios-steps">
          <li>
            <span className="ios-step-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Tap <b>Share</b> in Safari&apos;s toolbar.
          </li>
          <li>
            <span className="ios-step-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v8M8 12h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            Scroll and tap <b>Add to Home Screen</b>.
          </li>
          <li>
            <span className="ios-step-icon" aria-hidden="true">
              ✓
            </span>
            Tap <b>Add</b>, then open vChat from your Home Screen.
          </li>
        </ol>
        <button className="cta wide" type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
