import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RoomCount } from "@/components/LiveCounts";
import { AdSlot, SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { findSearchPage, SEARCH_PAGES } from "@/lib/searchPages";
import { SITE } from "@/lib/site";

// One static page per search need ("talk to strangers india", "hindi chat room"…). Content in
// lib/searchPages.ts; anything else at the top level is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return SEARCH_PAGES.map((p) => ({ topic: p.slug }));
}

type Props = { params: Promise<{ topic: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findSearchPage((await params).topic);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/${page.slug}` },
    openGraph: { title: `${page.title} · vChat`, description: page.description, url: `/${page.slug}`, type: "website" },
  };
}

export default async function SearchPage({ params }: Props) {
  const page = findSearchPage((await params).topic);
  if (!page) notFound();
  const related = page.related.map(findSearchPage).filter((p) => p !== undefined);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  const crumbsJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "vChat", item: SITE.url },
      { "@type": "ListItem", position: 2, name: page.h1, item: `${SITE.url}/${page.slug}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbsJsonLd) }} />
      <SiteHeader />
      <main className="wrap">
        <div className="seo-hero">
          <span className="eyebrow">
            {page.eyebrow}
            {page.room && (
              <>
                {" "}
                <RoomCount slug={page.room} suffix=" chatting now" />
              </>
            )}
          </span>
          <h1>{page.h1}</h1>
          <p className="lede">{page.lede}</p>
          <div className="seo-ctas">
            <Link className="cta" href={page.cta.href}>
              {page.cta.label} <span aria-hidden="true">→</span>
            </Link>
            {page.second && (
              <Link className="pill-link" href={page.second.href}>
                {page.second.label}
              </Link>
            )}
          </div>
        </div>

        <section className="seo-points" aria-label="Why vChat">
          {page.points.map((p) => (
            <div key={p.title} className="seo-point">
              <h2>{p.title}</h2>
              <p>{p.text}</p>
            </div>
          ))}
        </section>

        {page.sections.map((s) => (
          <section key={s.h2} className="seo-section">
            <h2>{s.h2}</h2>
            {s.paras.map((t) => (
              <p key={t.slice(0, 40)}>{t}</p>
            ))}
          </section>
        ))}

        <AdSlot />

        <section className="seo-section" aria-labelledby="seo-faq">
          <h2 id="seo-faq">Questions</h2>
          <div className="faq-list">
            {page.faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="seo-section" aria-labelledby="seo-more">
          <h2 id="seo-more">More on vChat</h2>
          <div className="topics">
            {related.map((r) => (
              <Link key={r.slug} href={`/${r.slug}`}>
                {r.h1}
              </Link>
            ))}
            <Link href="/rules">Chat rules</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
