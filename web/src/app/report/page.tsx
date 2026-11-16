import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Report abuse",
  description: "How to report someone on vChat, block them, and what happens after a report.",
  alternates: { canonical: "/report" },
};

export default function ReportPage() {
  return (
    <LegalPage title="Report abuse" updated={false} intro="If someone makes you feel unsafe, you can stop it in one tap.">
      <h2>In the app</h2>
      <ul>
        <li>
          <b>In a room</b>: long-press (or right-click) the message, then <b>Report…</b> and pick a reason. You can also
          block them there.
        </li>
        <li>
          <b>In random chat</b>: tap <b>⋯</b> at the top, then <b>Report…</b>. The chat ends, the person is blocked, and a
          moderator can read that conversation.
        </li>
        <li>
          <b>In a private chat</b>: tap <b>⋯</b> at the top, then <b>Block</b>.
        </li>
      </ul>
      <p>Blocking is instant and private: they aren&apos;t told, and you won&apos;t see or be matched with each other again.</p>

      <h2>What happens next</h2>
      <p>
        A moderator reviews the report with the messages around it, and may remove messages, mute or ban the account (see
        the <Link href="/rules">chat rules</Link>). Several reports in a short time take someone out of random chat until
        a moderator has looked.
      </p>

      <h2>Something serious</h2>
      <p>
        For anything involving a child, threats to someone&apos;s life, or other crimes, report in the app and also contact
        your local police. You can reach our Grievance Officer directly at{" "}
        <a href={`mailto:${SITE.grievanceEmail}`}>{SITE.grievanceEmail}</a> or on the <Link href="/contact">contact page</Link>.
      </p>
    </LegalPage>
  );
}
