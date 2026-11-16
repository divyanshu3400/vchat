import type { NextConfig } from "next";

// In production the app nginx sends /api/ and /ws/ straight to Django, so this rewrite is
// only used by `next dev` (and as a fallback). It keeps the browser on one origin, so the
// refresh cookie stays first-party and no CORS setup is needed.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone for the Docker image.
  output: "standalone",
  poweredByHeader: false,
  // Django URLs end with "/": pass them through instead of redirecting to the slash-less form.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // The slash is written out on both sides: `:path*` alone drops it, and Django then
    // refuses POSTs to the slash-less URL.
    return [{ source: "/api/:path*/", destination: `${BACKEND_URL}/api/:path*/` }];
  },
  async headers() {
    return [
      {
        // The service worker must never be cached, or phones keep an old one.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Microphone and camera for our own pages only (voice notes, calls); never for embedded ads.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
