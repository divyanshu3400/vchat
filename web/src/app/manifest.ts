import type { MetadataRoute } from "next";

/** What makes vChat installable: name, icons, colours, and opening straight into the chat. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/chat",
    name: "vChat · Anonymous chat",
    short_name: "vChat",
    description: "Chat with strangers and friends: rooms, random chat, voice and video calls.",
    start_url: "/chat?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F5FAF7",
    theme_color: "#0E8A5A",
    categories: ["social", "communication"],
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Random chat", short_name: "Random", url: "/chat/stranger?source=pwa", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
      { name: "Chats", short_name: "Chats", url: "/chat/inbox?source=pwa", icons: [{ src: "/app-icon/192", sizes: "192x192" }] },
    ],
  };
}
