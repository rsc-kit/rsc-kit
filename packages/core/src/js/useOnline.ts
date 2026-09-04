"use client";

import { useSyncExternalStore } from "react";
import { isReachable, subscribeReachable } from "./onlineStore";

/** The server is reachable from itself; assuming otherwise would render an
 * offline state into the HTML and mismatch on hydration. */
function getServerSnapshot(): boolean {
  return true;
}

/**
 * Whether the app can reach the server, as the router last observed it.
 *
 * See onlineStore.ts for why this is not `navigator.onLine`.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeReachable, isReachable, getServerSnapshot);
}

export function useOffline(): boolean {
  return !useOnline();
}
