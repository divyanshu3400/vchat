import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

// An invite link (/r/<code>), opened from WhatsApp or anywhere: a preview card, then into vChat.
type Props = { params: Promise<{ code: string }> };
type Preview = { name: string; emoji: string; description: string; members: number };

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function preview(code: string): Promise<Preview | null> {
  if (!/^[A-Za-z0-9_-]{6,16}$/.test(code)) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/rooms/invite/${code}/`, { cache: "no-store", headers: { Accept: "application/json" } });
    return res.ok ? ((await res.json()) as Preview) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const room = await preview((await params).code);
  const name = room ? `${room.emoji ? `${room.emoji} ` : ""}${room.name}` : "";
  // The page title gets " · vChat" from the root layout; link previews get the full line.
  const title = room ? `${name} · Join room` : "Room invite";
  const shareTitle = room ? `${name} · Join on vChat` : "Room invite · vChat";
  const description = room
    ? `${room.members} ${room.members === 1 ? "member" : "members"}. ${room.description || "A private room on vChat. Tap to join."}`
    : "This invite link doesn't work any more.";
  return { title, description, robots: { index: false, follow: false }, openGraph: { title: shareTitle, description, type: "website" } };
}

export default async function InvitePage({ params }: Props) {
  const { code } = await params;
  const room = await preview(code);
  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <div className="invite-page">
          {room ? (
            <>
              <span className="invite-page-emoji" aria-hidden="true">
                {room.emoji || "#"}
              </span>
              <h1>{room.name}</h1>
              <p>
                Private room · {room.members} {room.members === 1 ? "member" : "members"}
              </p>
              {room.description && <p className="invite-page-about">{room.description}</p>}
              <Link className="cta" href={`/chat/join/${code}`}>
                Join room
              </Link>
              <small>New here? Pick a nickname first. No email needed.</small>
            </>
          ) : (
            <>
              <span className="invite-page-emoji" aria-hidden="true">
                🔒
              </span>
              <h1>This invite link doesn&apos;t work</h1>
              <p>The room was deleted or its owner made a new link. Ask them for the new one.</p>
              <Link className="cta" href="/chat">
                Open vChat
              </Link>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
