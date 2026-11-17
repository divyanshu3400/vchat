import { defineConfig } from "@playwright/test";

/**
 * Layout checks: every main screen at five sizes, phone to big monitor (`make layout`).
 * Runs against the local dev servers (make dev-api, make dev-web) with the installed Chrome, so
 * no browser download is needed. Screenshots land in e2e/screenshots (not committed).
 */
const SIZES = [
  { name: "phone-375", width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: "tablet-768", width: 768, height: 1024, isMobile: false, hasTouch: true },
  { name: "laptop-1366", width: 1366, height: 768, isMobile: false, hasTouch: false },
  { name: "desktop-1920", width: 1920, height: 1080, isMobile: false, hasTouch: false },
  { name: "monitor-2560", width: 2560, height: 1440, isMobile: false, hasTouch: false },
];

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.LAYOUT_BASE_URL ?? "http://localhost:3100",
    channel: process.env.LAYOUT_BROWSER ?? "chrome",
    reducedMotion: "reduce",
  },
  projects: SIZES.map(({ name, width, height, isMobile, hasTouch }) => ({
    name,
    use: { viewport: { width, height }, isMobile, hasTouch, deviceScaleFactor: 1 },
  })),
});
