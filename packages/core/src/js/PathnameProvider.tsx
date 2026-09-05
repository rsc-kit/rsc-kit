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

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const PathnameContext = createContext<string>("/");

export function PathnameProvider({ value, children }: { value: string; children: ReactNode }) {
  return <PathnameContext.Provider value={value}>{children}</PathnameContext.Provider>;
}

/** What the server rendered. On the client this is the url it was hydrated with. */
export function useRenderedPathname(): string {
  return useContext(PathnameContext);
}
