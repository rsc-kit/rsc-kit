"use client";

/**
 * The query string, live across navigations.
 *
 * Deliberately unlike usePathname, which answers with the url being rendered.
 * A pathname is fixed for a given stored page; a query string is not — the
 * same route is asked for with `?q=shoes` and `?q=hats`, and a page stored
 * holding one of them would serve it to everyone.
 *
 * So there is no server snapshot to give, and this throws rather than
 * inventing one. React treats an error thrown during SSR as recoverable at the
 * nearest Suspense boundary: the fallback is what gets stored, and the client
 * renders the real thing on hydration. Without a boundary the error reaches the
 * root, nothing paints, and the build refuses the route and says why — which
 * is the same answer it gives for reading the request too early on the server.
 *
 * Returning an empty URLSearchParams instead would be worse than either: the
 * page would be stored showing results for no query at all, and nothing would
 * say so.
 */

import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

/**
 * Cached by the string it was parsed from.
 *
 * useSyncExternalStore compares snapshots by identity, so handing back a fresh
 * URLSearchParams on every read reads as "changed every time" and loops until
 * React gives up.
 */
let cached = { search: "", params: new URLSearchParams() };

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

function notify(): void {
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

function getSnapshot(): URLSearchParams {
  const search = currentSearch();

  if (search !== cached.search) {
    cached = { search, params: new URLSearchParams(search) };
  }

  return cached.params;
}

function getServerSnapshot(): URLSearchParams {
  throw new Error(
    "useSearchParams() was read while rendering on the server, where there is no query string. " +
      "Wrap the component in <Suspense> — or add a loading.tsx beside the page — so the fallback " +
      "is stored and the real value arrives in the browser.",
  );
}

export function useSearchParams(): URLSearchParams {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
