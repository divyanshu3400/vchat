"use client";

import { playSound, setSoundSettings, SOUND_LABELS, useSoundSettings } from "@/lib/sounds";
import { Icon } from "../bits";

/** Me screen: sounds on this device. Master switch, volume (plays a sample), each sound, vibration. */
export default function SoundSettings() {
  const s = useSoundSettings();

  return (
    <section className="settings" aria-labelledby="sounds-title">
      <h2 id="sounds-title" className="settings-title">
        Sounds
      </h2>

      <label className="setting">
        <span>
          <b>Sounds in vChat</b>
          <small>While vChat is open. Notification sounds come from your phone&apos;s settings.</small>
        </span>
        <input
          type="checkbox"
          className="switch"
          checked={s.on}
          suppressHydrationWarning
          onChange={(e) => {
            setSoundSettings({ on: e.target.checked });
            if (e.target.checked) playSound("receive", { force: true });
          }}
        />
      </label>

      {s.on && (
        <>
          <div className="setting sound-volume">
            <span>
              <b>Volume</b>
              <small>{s.volume === 0 ? "Silent" : `${s.volume}%`}</small>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={s.volume}
              aria-label="Sound volume"
              suppressHydrationWarning
              onChange={(e) => setSoundSettings({ volume: Number(e.target.value) })}
              onPointerUp={() => playSound("receive", { force: true, vibrate: false })}
              onKeyUp={() => playSound("receive", { force: true, vibrate: false })}
              style={{ "--fill": `${s.volume}%` } as React.CSSProperties}
            />
          </div>

          {SOUND_LABELS.map(([name, label, hint]) => (
            <div className="setting" key={name}>
              <span>
                <b>{label}</b>
                <small>{hint}</small>
              </span>
              <span className="sound-row-end">
                <button type="button" className="icon-btn sound-try" aria-label={`Play: ${label}`} onClick={() => playSound(name, { force: true })}>
                  <Icon name="play" size={16} />
                </button>
                <input
                  type="checkbox"
                  className="switch"
                  aria-label={label}
                  checked={s.events[name]}
                  suppressHydrationWarning
                  onChange={(e) => setSoundSettings({ events: { [name]: e.target.checked } })}
                />
              </span>
            </div>
          ))}
        </>
      )}

      {s.on && (
        <label className="setting">
          <span>
            <b>Vibrate</b>
            <small>A short buzz with each sound (Android phones)</small>
          </span>
          <input type="checkbox" className="switch" checked={s.vibrate} suppressHydrationWarning onChange={(e) => setSoundSettings({ vibrate: e.target.checked })} />
        </label>
      )}
    </section>
  );
}
