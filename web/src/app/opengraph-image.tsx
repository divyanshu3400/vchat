import { ImageResponse } from "next/og";

// The picture shown when someone shares a vChat link (WhatsApp, X, Facebook, Telegram…).
// No emoji: next/og fetches emoji images from a CDN at build time, and the server may not reach it.
export const alt = "vChat · Anonymous chat rooms, no sign-up";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const bubble = (text: string, me: boolean) => (
    <div
      style={{
        display: "flex",
        alignSelf: me ? "flex-end" : "flex-start",
        background: me ? "#0e8a5a" : "#ffffff",
        color: me ? "#ffffff" : "#0f241a",
        border: me ? "none" : "2px solid #d9e8df",
        borderRadius: 28,
        padding: "18px 26px",
        fontSize: 30,
        fontWeight: 600,
      }}
    >
      {text}
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg, #f5faf7 0%, #def2e7 100%)",
          padding: 70,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: 640 }}>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: "#0e8a5a", letterSpacing: -1 }}>vchat</div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: "#0f241a", lineHeight: 1.02, marginTop: 18, letterSpacing: -2 }}>
            Meet new people. Make friends.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#4d685b", marginTop: 26 }}>
            Free anonymous chat rooms · no sign-up · 18+
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 18, flex: 1, paddingLeft: 40 }}>
          {bubble("hey! where are you from?", false)}
          {bubble("Mumbai! you?", true)}
          {bubble("Lisbon :) add me?", false)}
          {bubble("done!", true)}
        </div>
      </div>
    ),
    size,
  );
}
