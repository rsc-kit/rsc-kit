"use client";

import { createContext, useContext } from "react";

/**
 * Whether the enclosing <Link> is mid-navigation, for the thing inside it
 * that wants to show as much.
 *
 * In its own module rather than beside Link: a module that exports a
 * component and a hook cannot be fast-refreshed, and every change to Link
 * became a full page reload in development for whoever had it open.
 */
export const LinkStatusContext = createContext<{ pending: boolean }>({
  pending: false,
});

export function useLinkStatus(): { pending: boolean } {
  return useContext(LinkStatusContext);
}
