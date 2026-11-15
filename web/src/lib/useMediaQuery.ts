import { useCallback, useSyncExternalStore } from "react";

/** Live result of a CSS media query; false during server render. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Laptop and wider: floating chat windows and the right ad rail. Matches the CSS breakpoint. */
export const DESKTOP_QUERY = "(min-width: 1280px)";
/** Tablet and wider: rail + conversation list are always visible. */
export const WIDE_QUERY = "(min-width: 768px)";
