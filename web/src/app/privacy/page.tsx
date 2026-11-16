import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What vChat collects, why, how long it is kept, who it is shared with, and how to get it deleted.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const r = SITE.retention;
  return (
    <LegalPage
      title="Privacy policy"
      intro={`This page explains what ${SITE.name} (run by ${SITE.operator}, ${SITE.location}) collects when you use it, why, and what you can do about it. In short: we collect as little as we can, we don't sell your data, and you can ask us to delete it.`}
    >
      <h2>What we collect</h2>
      <h3>When you join as a guest</h3>
      <ul>
        <li>The nickname and gender you pick, and that you confirmed you are 18 or older.</li>
        <li>A random account ID, kept in a secure cookie so this browser stays signed in.</li>
      </ul>
      <h3>If you save your account</h3>
      <ul>
        <li>Your email address and a password (stored only as a one-way hash, never readable by us).</li>
        <li>Your email is used to sign you in and to send you codes. Other users never see it.</li>
      </ul>
      <h3>When you chat</h3>
      <ul>
        <li>
          <b>Messages</b> in rooms, random chats and private messages, including photos, videos and voice messages you send.
          They are stored on our servers so they can be delivered, shown in your history and reviewed if someone reports
          them. <b>Messages are not end-to-end encrypted yet.</b> They are encrypted in transit (HTTPS).
        </li>
        <li>Friends, blocks and reports you make, and reactions, replies, edits and deletions.</li>
        <li>
          <b>Calls</b> go directly between the two devices, or through our relay server when a direct path isn&apos;t possible.
          We don&apos;t record calls.
        </li>
        <li>
          <b>Watching together</b>: which YouTube video is playing in a chat, while it plays. The video itself comes from
          YouTube.
        </li>
      </ul>
      <h3>Automatically</h3>
      <ul>
        <li>
          Your IP address and basic device information, in server logs and to fight spam and ban evasion (stored as a hash
          where possible).
        </li>
        <li>Whether you are online, so friends see a green dot.</li>
      </ul>
      <p>We don&apos;t ask for your real name, phone number, location, contacts or photos of you.</p>

      <h2>Why we use it</h2>
      <ul>
        <li>To run vChat: deliver messages, keep you signed in, match random chats, connect calls.</li>
        <li>To keep people safe: review reports, block spam, enforce the <Link href="/rules">chat rules</Link>.</li>
        <li>To show ads that pay for vChat, and to process vChat Plus payments.</li>
        <li>To meet legal obligations, for example responding to lawful requests from authorities.</li>
      </ul>

      <h2>Ads and cookies</h2>
      <p>
        vChat is supported by ads, served by Google and its partners. They may use cookies or similar technology to show
        ads, limit how often you see them, and measure them. Google&apos;s use of advertising cookies lets it and its partners
        serve ads based on your visits to this and other sites. You can turn off personalised ads in{" "}
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
          Google&apos;s ad settings
        </a>{" "}
        or opt out of third-party vendors at{" "}
        <a href="https://www.aboutads.info/choices" target="_blank" rel="noopener noreferrer">
          aboutads.info
        </a>
        . In the EEA, the UK and Switzerland we ask for your consent first.
      </p>
      <p>
        Our own cookies are only for signing in and remembering settings such as dark mode. vChat Plus members see no ads.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li>
          <b>Other users</b> see what you send them, your nickname, gender and online status. Strangers in random chat see
          your nickname, gender and the region you picked.
        </li>
        <li>
          <b>Service providers</b> who help run vChat: hosting, email delivery, Google (ads, and YouTube for watching
          together), and the payment provider for vChat Plus. They may only use the data to provide their service.
        </li>
        <li>
          <b>Authorities</b>, when the law requires it, or to protect someone from serious harm (for example child safety).
        </li>
      </ul>
      <p>We never sell your personal data.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Messages: {r.messages}, then deleted. Photos, videos and voice messages: {r.media}.</li>
        <li>Reports and the messages they point to: {r.reports}, to handle appeals and repeat abuse.</li>
        <li>IP addresses in logs: {r.ipLogs}.</li>
        <li>Your account: until you delete it. Guest accounts that are never used again are removed after a while.</li>
      </ul>
      <p>
        A message you delete &quot;for everyone&quot; disappears from every chat at once; we keep its text for reports until the
        times above run out.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Block or report anyone, delete your own messages, and remove friends at any time.</li>
        <li>
          Ask for a copy of your data, to correct it, or to delete your account and its data: write to{" "}
          <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> from the email on your account, or use the{" "}
          <Link href="/contact">contact page</Link>.
        </li>
        <li>
          Depending on where you live (for example under India&apos;s Digital Personal Data Protection Act or the EU GDPR), you may
          have further rights, including to complain to your data protection authority.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Everything travels over HTTPS. Passwords are hashed, sign-in tokens live in secure cookies that page scripts can&apos;t
        read, and photos are only reachable through private links that expire. No system is perfect: never share passwords,
        bank details or anything you can&apos;t take back with people you meet online.
      </p>

      <h2>Adults only</h2>
      <p>
        vChat is not for anyone under 18. If we learn that an account belongs to a minor, we delete it. If you know of one,
        please report it.
      </p>

      <h2>Grievance Officer</h2>
      <p>
        Under India&apos;s Information Technology Rules, 2021, complaints about content or this policy can be sent to our
        Grievance Officer: {SITE.grievanceOfficer}, <a href={`mailto:${SITE.grievanceEmail}`}>{SITE.grievanceEmail}</a>. We
        acknowledge complaints within 24 hours and resolve them within 15 days.
      </p>

      <h2>Changes</h2>
      <p>
        If we change this policy, we update the date at the top. If a change matters, we will tell you in the app before it
        applies.
      </p>
    </LegalPage>
  );
}
