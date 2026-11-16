import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { SITE } from "@/lib/site";

/** The frame of the About, Rules, Privacy, Terms and Contact pages. */
export default function LegalPage({
  title,
  intro,
  updated = true,
  children,
}: {
  title: string;
  intro?: ReactNode;
  updated?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="wrap legal">
        <article className="prose">
          <h1>{title}</h1>
          {updated && <p className="legal-updated">Last updated {SITE.lastUpdated}</p>}
          {intro && <p className="legal-intro">{intro}</p>}
          {children}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
