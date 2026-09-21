"use client";

/**
 * The url the server rendered, handed to the client hooks.
 *
 * usePathname used to answer "/" during a server render, because a hook has no
 * props and the module had nothing else to go on. Every prerendered page
 * therefore shipped with the wrong link marked active, corrected only once
 * hydration ran — a visible flash, and simply wrong on a route that ships no
 * client runtime at all.
 *
 * A context rather than a module-level variable: two requests render at once
 * in the same process, and a variable would hand one page the other's url.
 */

import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

// "/" with no provider at all - a component rendered outside the tree, a test.
// null from a provider means the url is not known: see below.
const PathnameContext = createContext<string | null>("/");

/**
 * `value` is null where the url is not known: the prerender of a shell for a
 * route that listed no urls, rendered once for every url it matches. A hook
 * reading it then throws, the way useSearchParams does on the server, so the
 * component lands in its nearest Suspense fallback and the browser renders
 * it with the real url - rather than the shell baking in "/" and every
 * document load of the route logging a hydration mismatch.
 */
export function PathnameProvider({ value, children }: { value: string | null; children: ReactNode }) {
  // The outermost client component on every page with a runtime, so its
  // first effect is the moment hydration has committed - the moment a
  // click on a <Link> is React's to handle. Until then the bootstrap
  // script's listener holds the taps; see earlyClicks. Announced through a
  // global rather than a module, because this component and the runtime
  // are bundled apart.
  useEffect(() => {
    const w = window as { __rsc_hydrated?: boolean; __rsc_on_hydrated?: () => void };

    if (w.__rsc_hydrated) return;

    w.__rsc_hydrated = true;
    w.__rsc_on_hydrated?.();
  }, []);

  return <PathnameContext.Provider value={value}>{children}</PathnameContext.Provider>;
}

/**
 * The digest a stored shell carries where the pathname was read under the
 * boundary that caught it. The client recognises it on hydration and does
 * not report the fallback as an error, because it is the designed path.
 */
export const PATHNAME_FALLBACK = "rsc-kit:pathname-fallback";

/** What the server rendered. On the client this is the url it was hydrated with. */
export function useRenderedPathname(): string {
  const value = useContext(PathnameContext);

  if (value !== null) return value;

  // The browser always knows; only a server render for no particular url
  // does not.
  if (typeof window !== "undefined") return window.location.pathname;

  const error = new Error(
    "usePathname() was read while rendering a shell for a route that lists no urls, where there is no " +
      "pathname to give: one shell serves every url the route matches. Wrap the component in <Suspense> " +
      "so the fallback is stored and the real value arrives in the browser.",
  ) as Error & { digest?: string };

  error.digest = PATHNAME_FALLBACK;

  throw error;
}
