import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Safety and moderation",
  description:
    "How vChat keeps chats safe: 18+ only, no sexual content, one-tap block and report, automatic spam filters, moderators who review reports, and bans that stick.",
  alternates: { canonical: "/safety" },
};

export default function SafetyPage() {
  return (
    <LegalPage
      title="Safety and moderation"
      intro="vChat is a place to talk to new people and make friends. Here is how we keep it that way, and how you can stay safe."
    >
      <h2>What we don&apos;t allow</h2>
      <ul>
        <li>Anyone under 18.</li>
        <li>Sexual content of any kind: messages, photos, videos, voice notes or calls, in public or in private.</li>
        <li>Harassment, threats, hate speech and slurs.</li>
        <li>Scams: asking for money, gift cards, crypto, OTPs or passwords.</li>
        <li>Spam, advertising and bots.</li>
        <li>Violence, illegal content, or encouraging self-harm.</li>
      </ul>
      <p>
        The full list is in the <Link href="/rules">chat rules</Link>.
      </p>

      <h2>How moderation works</h2>
      <ul>
        <li>
          <b>Report in one tap</b>: on any message, in a random chat&apos;s menu, or from someone&apos;s profile. Reports go to
          our moderators with the messages they point to.
        </li>
        <li>
          <b>Block in one tap</b>: a blocked person can&apos;t message you, call you or be matched with you again.
        </li>
        <li>
          <b>Automatic filters</b>: flooding a room or posting many links mutes the sender. Names with rude words or phone
          numbers can&apos;t be picked.
        </li>
        <li>
          <b>Bans that stick</b>: serious or repeated breaks lead to bans of 24 hours, 7 days or for good. Making new
          accounts to get around a ban is blocked.
        </li>
        <li>
          <b>Fast removal from random chat</b>: several reports in a short time take someone out of random chat until a
          moderator has looked.
        </li>
        <li>
          <b>Anything involving a child</b> is removed, the account is banned, and we report it to the authorities.
        </li>
      </ul>

      <h2>Your privacy protects you</h2>
      <ul>
        <li>In random chat neither person sees the other&apos;s name. Your photo is shown only to people you add as friends.</li>
        <li>We never show your email, phone number or location to anyone.</li>
        <li>Photos, videos and voice notes are deleted 3 days after they are sent; random chats are deleted 7 days after they end.</li>
        <li>Photos from strangers stay blurred until you choose to open them, and vChat asks before you open a stranger&apos;s link.</li>
        <li>You can hide your online status and read receipts, stop people finding you by name, and delete your account any time.</li>
      </ul>

      <h2>Staying safe with people you just met</h2>
      <ul>
        <li>Don&apos;t share your phone number, address, school, workplace or social accounts early on.</li>
        <li>Never send money, gift cards, OTPs or passwords, whatever the story.</li>
        <li>Moving to another app is how most blackmail scams start. vChat warns you when you&apos;re about to share contact details.</li>
        <li>If someone makes you uncomfortable, you don&apos;t owe them an explanation: block, report, and move on.</li>
        <li>
          If you are in danger or thinking about hurting yourself, contact local emergency services or a crisis helpline
          right away.
        </li>
      </ul>

      <h2>Contact us</h2>
      <p>
        To report something serious or appeal a ban, use the <Link href="/report">report page</Link> or{" "}
        <Link href="/contact">contact us</Link>. We read every message.
      </p>
    </LegalPage>
  );
}
