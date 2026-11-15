import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RoomCount } from "@/components/LiveCounts";
import RoomClock from "@/components/RoomClock";
import { AdSlot, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ALL_ROOMS, findRoom, REGION_ROOMS, TOPIC_ROOMS } from "@/lib/rooms";

// One static, indexable page per room: this is what ranks in search. The live chat itself is /chat/<slug> (noindex).
export const dynamicParams = false;

export function generateStaticParams() {
  return ALL_ROOMS.map((r) => ({ slug: r.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const room = findRoom((await params).slug);
  if (!room) return {};
  const isRegion = "timezone" in room;
  const title = isRegion ? `${room.name} chat room: talk to strangers in ${room.name}` : `${room.name} chat room`;
  const description = isRegion
    ? `Free anonymous chat with people in ${room.name}. No sign-up, no email. Pick a nickname and start chatting.`
    : `${room.blurb} Free anonymous ${room.name.toLowerCase()} chat room, no sign-up needed.`;
  return { title, description, alternates: { canonical: `/rooms/${room.slug}` } };
}

export default async function RoomPage({ params }: Props) {
  const room = findRoom((await params).slug);
  if (!room) notFound();
  const region = "timezone" in room ? room : null;
  const others = (region ? REGION_ROOMS : TOPIC_ROOMS).filter((r) => r.slug !== room.slug);

  return (
    <>
      <SiteHeader />
      <main className="wrap">
        <div className="room-page">
          <span className="eyebrow">
            {region ? `Region room · ${region.city}` : "Topic room"} <RoomCount slug={room.slug} suffix=" chatting now" />
          </span>
          <h1>{room.name} chat room</h1>
          {region ? (
            <p className="lede">
              It&apos;s <RoomClock timeZone={region.timezone} /> in {region.city} right now. Chat anonymously with people
              across {room.name}. No sign-up, no email, just pick a nickname.
            </p>
          ) : (
            "blurb" in room && <p className="lede">{room.blurb} Chat anonymously, no sign-up needed.</p>
          )}
          <Link className="cta" href={`/?room=${room.slug}#join`}>
            Join {room.name} <span aria-hidden="true">→</span>
          </Link>
          <div className="rules">
            <h2>Room rules</h2>
            <ul>
              <li>18+ only. Be kind; no hate, harassment or sexual content.</li>
              <li>No spam, links to scams, or asking for money.</li>
              <li>Don&apos;t share personal details like your address or phone number.</li>
              <li>Block anyone who bothers you, and report rule-breakers.</li>
            </ul>
          </div>
          <AdSlot />
        </div>

        <section className="section" aria-labelledby="more-rooms">
          <div className="sec-head">
            <h2 id="more-rooms">More rooms</h2>
          </div>
          <div className="topics">
            {others.map((r) => (
              <Link key={r.slug} href={`/rooms/${r.slug}`}>
                {r.name}
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
