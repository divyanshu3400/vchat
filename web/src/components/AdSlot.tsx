import { AD_SIZES, ADS_MODE, type AdKind } from "@/lib/ads";

/**
 * A reserved ad space. Its box has the ad's exact size from the first paint, so the page never
 * jumps when an ad arrives. Renders nothing while ads are off.
 */
export default function AdSlot({ kind, className = "" }: { kind: AdKind; className?: string }) {
  if (ADS_MODE === "off") return null;
  const size = AD_SIZES[kind];
  const style = kind === "native" ? undefined : { width: size.w, height: size.h };

  return (
    <div className={`ad-slot ad-${kind} ${ADS_MODE === "placeholder" ? "ad-placeholder" : ""} ${className}`} role="complementary" aria-label="Advertisement">
      <div className="ad-box" style={style}>
        {ADS_MODE === "placeholder" && (
          <span>
            Ad · {kind === "native" ? "Sponsored" : size.label}
          </span>
        )}
        {/* live: the ad network's tag mounts here (after EU/UK consent where required). */}
      </div>
    </div>
  );
}
