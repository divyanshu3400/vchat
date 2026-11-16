import type { Metadata } from "next";
import Link from "next/link";
import LegalPage from "@/components/LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using vChat: who can use it, your content, vChat Plus, bans, and the legal fine print.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro={`These terms are an agreement between you and ${SITE.operator} (“we”), which runs ${SITE.name}. By using vChat you accept them. If you don't, please don't use vChat.`}
    >
      <h2>1. Who can use vChat</h2>
      <p>
        You must be at least 18 years old and allowed to use a service like this where you live. One person, one account
        for chatting: don&apos;t share accounts or create new ones to get around a ban.
      </p>

      <h2>2. Your account</h2>
      <p>
        A guest account lives in your browser and can be lost if the browser forgets it. Saving it with an email and a
        password lets you sign in elsewhere. Keep your password secret; you are responsible for what happens on your account.
      </p>

      <h2>3. What you post</h2>
      <p>
        You own your messages, photos, videos and voice messages. You give us permission to store, deliver and show them
        to the people you send them to, and to review them when someone reports them, for as long as we need to run and
        protect vChat. You confirm you have the right to share what you send.
      </p>
      <p>
        You must follow the <Link href="/rules">chat rules</Link>. We may remove content, limit features, or suspend or ban
        accounts that break them or the law, with or without notice. Serious cases may be reported to the authorities.
      </p>

      <h2>4. Other people</h2>
      <p>
        People on vChat are strangers. We don&apos;t check who they are, and we aren&apos;t responsible for what they say or do,
        on vChat or after you leave it. Be careful, and use block and report.
      </p>

      <h2>5. vChat Plus</h2>
      <p>
        Plus is an optional paid membership that removes ads and adds features listed on the Me screen. Prices are shown
        before you pay. It renews only if you choose a renewing plan, and you can cancel any time; it stays active until the
        end of the period you paid for. Payments are handled by our payment provider. Unless the law requires otherwise,
        payments aren&apos;t refunded for partly used periods. If we ban an account for breaking the rules, its Plus ends too.
      </p>

      <h2>6. Ads and other services</h2>
      <p>
        vChat shows ads from third parties and lets you watch YouTube videos together, which are subject to{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">
          YouTube&apos;s terms
        </a>
        . We aren&apos;t responsible for other sites, ads or links.
      </p>

      <h2>7. Changes and availability</h2>
      <p>
        We work hard to keep vChat running, but it is provided “as is” and may change, pause or stop. We may update these
        terms; the date at the top shows the latest version, and important changes are announced in the app.
      </p>

      <h2>8. Limits of liability</h2>
      <p>
        To the extent the law allows, we aren&apos;t liable for indirect or consequential losses, or for content posted by
        users. Nothing here limits rights you have under consumer law that can&apos;t be limited.
      </p>

      <h2>9. Leaving vChat</h2>
      <p>
        You can stop using vChat at any time and ask us to delete your account (see the <Link href="/privacy">privacy
        policy</Link>).
      </p>

      <h2>10. Law and disputes</h2>
      <p>
        These terms are governed by the laws of India. Complaints can first go to our Grievance Officer at{" "}
        <a href={`mailto:${SITE.grievanceEmail}`}>{SITE.grievanceEmail}</a>; otherwise the courts of India have jurisdiction.
      </p>

      <h2>Contact</h2>
      <p>
        <Link href="/contact">Contact page</Link> · <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
      </p>
    </LegalPage>
  );
}
