import { ImageResponse } from "next/og";

// The home-screen icon in every size the phone asks for: /app-icon/192, /app-icon/512,
// /app-icon/maskable (Android's shaped icons keep a safe zone), /app-icon/badge (notification badge).
const VARIANTS: Record<string, { size: number; pad: number; mono?: boolean }> = {
  "192": { size: 192, pad: 0.18 },
  "512": { size: 512, pad: 0.18 },
  maskable: { size: 512, pad: 0.3 },
  apple: { size: 180, pad: 0.16 },
  badge: { size: 96, pad: 0.12, mono: true },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((variant) => ({ variant }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ variant: string }> }) {
  const v = VARIANTS[(await params).variant];
  if (!v) return new Response("Not found", { status: 404 });
  const inner = Math.round(v.size * (1 - 2 * v.pad));
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: v.mono ? "transparent" : "linear-gradient(140deg, #1fb47a 0%, #0e8a5a 60%, #0a6d47 100%)",
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 32 32">
          <path
            d="M3 16c3-8 6-8 9 0s6 8 9 0 6-8 8-2"
            stroke={v.mono ? "#000000" : "#ffffff"}
            strokeWidth={3.4}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { width: v.size, height: v.size },
  );
}
