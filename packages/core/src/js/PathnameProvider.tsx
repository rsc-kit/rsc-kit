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

const PathnameContext = createContext<string>("/");

export function PathnameProvider({ value, children }: { value: string; children: ReactNode }) {
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

/** What the server rendered. On the client this is the url it was hydrated with. */
export function useRenderedPathname(): string {
  return useContext(PathnameContext);
}
