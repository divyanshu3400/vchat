import type { MetadataRoute } from "next";
import { ALL_ROOMS } from "@/lib/rooms";
import { SEARCH_PAGES, SEARCH_PAGES_UPDATED } from "@/lib/searchPages";
import { SITE } from "@/lib/site";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
// The legal pages say when they last changed; use the same date.
const LEGAL_UPDATED = new Date(SITE.lastUpdated);

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1, lastModified: new Date(SEARCH_PAGES_UPDATED) },
    ...SEARCH_PAGES.map((p) => ({
      url: `${SITE_URL}/${p.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.9,
      lastModified: new Date(SEARCH_PAGES_UPDATED),
    })),
    ...["about", "safety", "rules", "privacy", "terms", "report", "contact"].map((p) => ({
      url: `${SITE_URL}/${p}`,
      changeFrequency: "monthly" as const,
      priority: p === "about" || p === "rules" || p === "safety" ? 0.6 : 0.3,
      lastModified: LEGAL_UPDATED,
    })),
    ...ALL_ROOMS.map((r) => ({
      url: `${SITE_URL}/rooms/${r.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
      lastModified: new Date(SEARCH_PAGES_UPDATED),
    })),
  ];
}
