import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Chat rules",
  description: "The vChat community rules: who can join, what isn't allowed, and what happens when someone breaks the rules.",
  alternates: { canonical: "/rules" },
};

export default function RulesPage() {
  return (
    <LegalPage
      title="Chat rules"
      intro="vChat works when people treat each other like people. These rules apply in rooms, random chats, private messages and calls."
    >
      <h2>1. Adults only</h2>
      <p>You must be 18 or older. If someone looks or says they are under 18, report them and stop talking to them.</p>

      <h2>2. Be decent</h2>
      <ul>
        <li>No harassment, threats, stalking, or pushing someone who said no.</li>
        <li>No hate speech or slurs about race, religion, caste, nationality, gender, sexuality or disability.</li>
        <li>No sexual messages, photos or calls with someone who didn&apos;t clearly agree, and never in public rooms.</li>
      </ul>

      <h2>3. Never allowed</h2>
      <ul>
        <li>Anything sexual involving minors. We report it to the authorities.</li>
        <li>Sharing someone&apos;s private information (address, phone, photos) without their permission.</li>
        <li>Scams: asking for money, gift cards, crypto, OTPs or passwords.</li>
        <li>Spam, ads, link flooding, bots, and selling anything.</li>
        <li>Violent or illegal content, or encouraging self-harm.</li>
        <li>Pretending to be someone else, including vChat staff.</li>
      </ul>

      <h2>4. Keep yourself safe</h2>
      <ul>
        <li>Never share your address, phone number, passwords or bank details with people you meet here.</li>
        <li>A stranger&apos;s link can be a trap: vChat asks before opening one. Think twice.</li>
        <li>Photos from strangers stay blurred until you tap them.</li>
        <li>You can block anyone, any time. They won&apos;t be matched with you again.</li>
      </ul>

      <h2>What happens when someone breaks the rules</h2>
      <ol>
        <li>
          <b>Automatic mute</b>: flooding a room with the same message or with links mutes you for 10 minutes.
        </li>
        <li>
          <b>Temporary ban</b>: after reports are reviewed, an account can be banned for 24 hours or 7 days.
        </li>
        <li>
          <b>Permanent ban</b>: for serious or repeated breaks. Creating new guest accounts to get around a ban is not
          allowed and is blocked.
        </li>
      </ol>
      <p>
        Several reports in a short time can take someone out of random chat until a moderator has looked. We may remove
        messages that break these rules.
      </p>

      <h2>How to report</h2>
      <p>
        Tap <b>Report</b> on a message or in the menu of a random chat, or see <Link href="/report">reporting abuse</Link>. If
        you think a decision about your account was wrong, write to us on the <Link href="/contact">contact page</Link>.
      </p>
    </LegalPage>
  );
}
