"use client";

import { useSyncExternalStore } from "react";
import { useRenderedPathname } from "./PathnameProvider";

let currentPathname = typeof window !== "undefined" ? window.location.pathname : "/";
const listeners = new Set<() => void>();

function notify(): void {
  currentPathname = window.location.pathname;
  listeners.forEach((fn) => fn());
}

if (typeof window !== "undefined") {
  window.addEventListener("rsc-navigate", notify);
  window.addEventListener("popstate", notify);
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): string {
  return currentPathname;
}

/**
 * The current pathname, live across navigations.
 *
 * The server snapshot comes from the url being rendered rather than a
 * constant. It used to be "/" — so a nav bar on any other page rendered with
 * the wrong link marked active, and only hydration put it right.
 */
export function usePathname(): string {
  const rendered = useRenderedPathname();

  return useSyncExternalStore(subscribe, getSnapshot, () => rendered);
}
