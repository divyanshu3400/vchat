import type { MetadataRoute } from "next";
import { ALL_ROOMS } from "@/lib/rooms";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...ALL_ROOMS.map((r) => ({
      url: `${SITE_URL}/rooms/${r.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
