import type { Metadata } from "next";
import Link from "next/link";
import ChatPreview from "@/components/ChatPreview";
import JoinForm from "@/components/JoinForm";
import { RoomCount } from "@/components/LiveCounts";
import RoomClock from "@/components/RoomClock";
import { AdSlot, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { REGION_ROOMS, TOPIC_ROOMS } from "@/lib/rooms";
import { SITE } from "@/lib/site";

const FAQ = [
  ["Is vChat free?", "Yes. Chat rooms, private messages, friends and calls are all free. The site is supported by ads."],
  [
    "Do I need to register?",
    "No. Pick a nickname and you're in. To keep your friends and log in on another phone or laptop, save your account with a username and a password whenever you like. An email is optional.",
  ],
  ["Who can join?", "Anyone aged 18 or older, from any country. Rooms are grouped by region and by topic, and there is a Hindi & Hinglish room too."],
  [
    "Is it safe to chat with strangers here?",
    "Every room has moderators, spam is filtered automatically, and you can block or report anyone in one tap. Never share your address, phone number or money with people you meet online.",
  ],
  [
    "Can I video call someone I just met?",
    "Video calls are only between friends. In a random chat you can ask for a voice call, and it starts only if the other person accepts.",
  ],
  [
    "Can we watch videos together?",
    "Yes. In a chat with a friend or a stranger, share a YouTube link and it plays for both of you, in sync.",
  ],
] as const;

export const metadata: Metadata = { alternates: { canonical: "/" } };

// Who we are, for Google's knowledge panel and sitelinks search.
const siteJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: SITE.url,
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    email: SITE.supportEmail,
    parentOrganization: { "@type": "Organization", name: SITE.operator },
  },
];

// FAQ rich results in Google search.
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }} />
      <SiteHeader />

      <main>
        <div className="wrap hero">
          <div>
            <span className="eyebrow">Anonymous chat · No sign-up · 18+</span>
            <h1>
              Strangers tonight. <em>Friends</em> by morning.
            </h1>
            <p className="lede">
              Jump into live chat rooms with people from all over the world. Pick a name and you&apos;re in. No email,
              no phone number.
            </p>
            <JoinForm />
          </div>
          <ChatPreview />
        </div>

        <section id="rooms" className="section">
          <div className="wrap">
            <div className="sec-head">
              <h2>Someone&apos;s awake somewhere.</h2>
              <p>
                Chat with people in your time zone, or catch someone on the other side of the world. Every room has its
                own moderators and rules.
              </p>
            </div>
            <div className="rooms">
              {REGION_ROOMS.map((r) => (
                <Link key={r.slug} className="room" href={`/rooms/${r.slug}`}>
                  <RoomClock className="clock" timeZone={r.timezone} />
                  <span className="city">{r.city}</span>
                  <span className="room-meta">
                    <b>{r.name}</b>
                    <RoomCount slug={r.slug} />
                  </span>
                </Link>
              ))}
            </div>
            <div className="topics">
              {TOPIC_ROOMS.map((t) => (
                <Link key={t.slug} href={`/rooms/${t.slug}`}>
                  {t.name}
                  <RoomCount slug={t.slug} />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <div className="wrap">
          <AdSlot />
        </div>

        <section id="how" className="section">
          <div className="wrap">
            <div className="sec-head">
              <h2>Chatting in under ten seconds</h2>
            </div>
            <div className="steps">
              <div className="step">
                <span className="n">1</span>
                <h3>Pick a nickname</h3>
                <p>No email, no phone number, no password. Just a name people will see.</p>
              </div>
              <div className="step">
                <span className="n">2</span>
                <h3>Join a room</h3>
                <p>Choose a region or a topic and start talking with whoever is online right now.</p>
              </div>
              <div className="step">
                <span className="n">3</span>
                <h3>Add a friend</h3>
                <p>Liked talking to someone? Send a friend request, then chat privately or call.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="wrap">
            <div className="sec-head">
              <h2>Anonymous, but never a free-for-all</h2>
              <p>The fun of talking to strangers, without the spam, bots and creeps that ruin other chat sites.</p>
            </div>
            <div className="feat">
              <div className="f big">
                <div>
                  <span className="tag">Friends that stick</span>
                  <h3 style={{ marginTop: 12 }}>Your friend list lives on, even as a guest.</h3>
                  <p style={{ marginTop: 12 }}>
                    Message friends privately, see when they&apos;re online, and start a voice or video call. Save your
                    account with an email to keep them on every device.
                  </p>
                </div>
                <div className="friends" aria-label="Example friend list">
                  <div className="fr">
                    <span className="av" style={{ background: "#FFB23F" }}>M</span>
                    <div><div className="nm">mira_reads</div><div className="st">Online · in Late-night talks</div></div>
                    <span className="act">Video call</span>
                  </div>
                  <div className="fr">
                    <span className="av" style={{ background: "#3DDCB0" }}>K</span>
                    <div><div className="nm">kai.from.manila</div><div className="st">Last seen 12 min ago</div></div>
                    <span className="act">Message</span>
                  </div>
                  <div className="fr">
                    <span className="av" style={{ background: "#FF4F79" }}>J</span>
                    <div><div className="nm">jules.mtl</div><div className="st">Online · in Gaming</div></div>
                    <span className="act">Voice call</span>
                  </div>
                </div>
              </div>
              <div className="f">
                <span className="tag">Calls</span>
                <h3>Voice &amp; video, friends only</h3>
                <p>Strangers can&apos;t call you. Only people you&apos;ve accepted as friends can.</p>
              </div>
              <div className="f">
                <span className="tag">Control</span>
                <h3>One tap to block</h3>
                <p>Blocked people can&apos;t see your messages and you won&apos;t see theirs.</p>
              </div>
              <div className="f">
                <span className="tag">Clean rooms</span>
                <h3>Spam gets muted fast</h3>
                <p>Flooding is blocked automatically and every report goes to a moderator.</p>
              </div>
              <div className="f">
                <span className="tag">Privacy</span>
                <h3>Your number stays yours</h3>
                <p>We never ask for your phone or email to chat. Share only what you want.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="section">
          <div className="wrap faq">
            <div className="sec-head" style={{ display: "block" }}>
              <h2>Questions people ask</h2>
            </div>
            <div>
              {FAQ.map(([q, a], i) => (
                <details key={q} open={i === 0}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <div className="wrap">
          <div className="final">
            <h2>Someone&apos;s waiting to say hi.</h2>
            <Link href="/#join">Start chatting →</Link>
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
