import type { NextConfig } from "next";

// Django API. The browser always calls same-origin /api/*, so the refresh cookie
// stays first-party and no CORS setup is needed.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    // Client calls /api/auth/guest  ->  Django /api/auth/guest/ (Django URLs end with a slash).
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*/` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
