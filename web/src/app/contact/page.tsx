import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "@/components/ContactForm";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact vChat: questions, problems, reports, account and data requests, and our Grievance Officer.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <LegalPage title="Contact us" updated={false} intro="We read every message and reply by email, usually within two days.">
      <p>
        To report someone right now, use <b>Report</b> in the app (see <Link href="/report">reporting abuse</Link>): it
        reaches a moderator with the messages attached.
      </p>
      <ContactForm />
      <h2>Other ways</h2>
      <ul>
        <li>
          Email: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
        </li>
        <li>
          Grievance Officer (India IT Rules, 2021): {SITE.grievanceOfficer},{" "}
          <a href={`mailto:${SITE.grievanceEmail}`}>{SITE.grievanceEmail}</a>. Complaints are acknowledged within 24 hours and
          resolved within 15 days.
        </li>
        <li>
          Data requests (copy, correction, deletion): write from the email on your account. See the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </li>
      </ul>
      <p className="legal-updated">
        {SITE.name} is run by {SITE.operator}, {SITE.location}.
      </p>
    </LegalPage>
  );
}
