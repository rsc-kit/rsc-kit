"use client";

/**
 * The query string, live across navigations.
 *
 * Deliberately unlike usePathname, which answers with the url being rendered.
 * A pathname is fixed for a given stored page; a query string is not — the
 * same route is asked for with `?q=shoes` and `?q=hats`, and a page stored
 * holding one of them would serve it to everyone.
 *
 * So the server answers only when it is rendering for a request: a page
 * rendered per visitor - or the hole of a stored shell, filled per request -
 * has that visitor's query, and a component reading it renders on the server
 * like any other, with no flash. Where the HTML may be stored - the build -
 * there is no query to give, and this throws rather than inventing one.
 * React treats that as recoverable at the nearest Suspense boundary: the
 * fallback is what gets stored, and the client renders the real thing on
 * hydration. Without a boundary the error reaches the root, nothing paints,
 * and the build refuses the route and says why.
 *
 * Returning an empty URLSearchParams at build instead would be worse than
 * either: the page would be stored showing results for no query at all, and
 * nothing would say so.
 */

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Context } from "react";

/**
 * The query of the request the server is rendering for, or null when the
 * render may be stored. Set by the server's render around the whole tree;
 * absent in the browser.
 *
 * Kept on a global symbol so the server's entry and the copy of this module
 * the client components were bundled with agree on one context.
 */
export function searchSnapshotContext(): Context<string | null | undefined> {
  const key = Symbol.for("rsc-kit.search-snapshot");
  const store = globalThis as Record<symbol, Context<string | null | undefined> | undefined>;

  // undefined: no server render set it - the browser, hydrating.
  return (store[key] ??= createContext<string | null | undefined>(undefined));
}

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

let listening = false;

function subscribe(callback: () => void): () => void {
  // On the first subscriber rather than at module load. A listener attached
  // when the module is evaluated is attached to whatever `window` exists at
  // that moment — which in a test that installs a DOM after its imports is
  // none, and the hook silently never updates. Attaching here is the shape
  // useSyncExternalStore expects and is correct wherever the module loads.
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("rsc-navigate", notify);
    window.addEventListener("popstate", notify);
    listening = true;
  }

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

/**
 * The digest a stored page carries where the query was read under the
 * boundary that caught it. The client recognises it on hydration and does
 * not report the fallback as an error, because it is the designed path.
 */
export const SEARCH_PARAMS_FALLBACK = "rsc-kit:search-params-fallback";

/** One URLSearchParams per query the server renders for: the snapshot must keep its identity. */
const serverParams = new Map<string, URLSearchParams>();

function paramsFor(search: string): URLSearchParams {
  let params = serverParams.get(search);

  if (!params) {
    if (serverParams.size > 500) serverParams.clear();
    params = new URLSearchParams(search);
    serverParams.set(search, params);
  }

  return params;
}

function serverSnapshot(search: string | null | undefined): URLSearchParams {
  // The server rendering for a request: that request's query.
  if (typeof search === "string") return paramsFor(search);

  // Hydrating in the browser, where no server render set one: the server
  // rendered for the url in the bar, so that is what it saw. A part the
  // server refused was never hydrated - the client renders it fresh.
  if (search === undefined && typeof window !== "undefined") return getSnapshot();

  // A render whose HTML may be stored - or a server render nobody told.
  return refuse();
}

function refuse(): URLSearchParams {
  const error = new Error(
    "useSearchParams() was read while rendering a page that may be stored, where there is no query string to give: " +
      "a stored page would serve one visitor's query to everyone. Wrap the component in <Suspense> — or add a " +
      "loading.tsx beside the page — so the fallback is stored and the real value arrives in the browser.",
  ) as Error & { digest?: string };

  error.digest = SEARCH_PARAMS_FALLBACK;

  throw error;
}

export function useSearchParams(): URLSearchParams {
  const search = useContext(searchSnapshotContext());

  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot(search));
}
