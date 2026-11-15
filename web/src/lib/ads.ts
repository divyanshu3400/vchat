/**
 * Ad slots across the site.
 *   off          render nothing (default until an ad network approves the site)
 *   placeholder  dashed boxes at the real sizes, for design review
 *   live         reserved boxes the ad network fills (network tag still to add)
 * Baked in at build time.
 */
export type AdsMode = "off" | "placeholder" | "live";

const raw = process.env.NEXT_PUBLIC_ADS_MODE;
export const ADS_MODE: AdsMode = raw === "placeholder" || raw === "live" ? raw : "off";
export const ADS_ON = ADS_MODE !== "off";

/** Standard IAB sizes we use, and where. */
export const AD_SIZES = {
  anchor: { w: 320, h: 50, label: "320×50" }, // phone, above the tab bar
  rect: { w: 300, h: 250, label: "300×250" }, // waiting moments (searching for a stranger)
  sky: { w: 300, h: 600, label: "300×600" }, // laptop right rail
  leader: { w: 728, h: 90, label: "728×90" }, // laptop home
  native: { w: 0, h: 0, label: "native" }, // a "Sponsored" row or card shaped like our own content
} as const;

export type AdKind = keyof typeof AD_SIZES;

/** One native row after every N conversation rows. */
export const NATIVE_EVERY = 8;
