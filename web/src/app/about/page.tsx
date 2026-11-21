import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "About vChat",
  description:
    "vChat is a free, anonymous chat site for people 18 and older: live rooms by region and topic, one-on-one random chat, friends, voice and video calls.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <LegalPage
      title="About vChat"
      updated={false}
      intro="vChat is a free place to talk to people from all over the world, without handing over your phone number or your life story."
    >
      <h2>What you can do here</h2>
      <ul>
        <li>
          <b>Chat rooms</b> by region (Europe, South Asia, Latin America…) and by topic (music, gaming, late-night talks…).
        </li>
        <li>
          <b>Random chat</b>: one-on-one with a stranger. Skip any time, keep the good ones as friends.
        </li>
        <li>
          <b>Friends</b>: private messages with photos, videos and voice messages, voice and video calls, and watching
          YouTube together.
        </li>
      </ul>

      <h2>Anonymous by default</h2>
      <p>
        You join with a nickname. No phone number, no real name. If you want to keep your friends and log in on another
        device, you can save your account with an email address, which nobody else on vChat can see.
      </p>

      <h2>Safety</h2>
      <p>
        vChat is only for people aged 18 and older. Everyone can block or report anyone in one tap, spam is muted automatically, and
        reports are reviewed by people. Read the <Link href="/rules">chat rules</Link> to see what isn&apos;t allowed and what
        happens when someone breaks them.
      </p>

      <h2>How vChat is paid for</h2>
      <p>
        vChat is free and supported by ads. <b>vChat Plus</b> removes ads and adds a few extras for people who want to support
        the site.
      </p>

      <h2>Who runs it</h2>
      <p>
        vChat is run by {SITE.operator}, {SITE.location}. Questions, ideas or problems: write to us on the{" "}
        <Link href="/contact">contact page</Link> or at <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
      </p>
    </LegalPage>
  );
}
