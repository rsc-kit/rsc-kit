/**
 * Whether the app can currently reach the server.
 *
 * Deliberately free of React so the navigation engine can report into it —
 * navigate.ts imports nothing that would pull a renderer into the module that
 * every navigation goes through. The hook lives in useOnline.ts.
 *
 * Not `navigator.onLine` on its own, which reports whether a network interface
 * is up rather than whether anything answers on it: a captive portal, a hotel
 * splash page and a server that is simply down all read as online. The router
 * knows better, because it sees how requests actually end.
 */

let reachable = true;
const listeners = new Set<() => void>();

/**
 * The outcome of a real request.
 *
 * A boolean rather than an object, so React compares snapshots by value —
 * returning a fresh object per read reads as "changed every render" and loops
 * until React throws.
 */
export function reportReachable(next: boolean): void {
  if (reachable === next) return;

  reachable = next;
  listeners.forEach((fn) => fn());
}

export function subscribeReachable(callback: () => void): () => void {
  listeners.add(callback);

  return () => listeners.delete(callback);
}

export function isReachable(): boolean {
  return reachable;
}

if (typeof window !== "undefined") {
  // Losing the interface is the one thing the browser knows for certain.
  window.addEventListener("offline", () => reportReachable(false));
  // Regaining it only means a request is worth trying again — whether anything
  // answers is settled by the next request that runs, not by this event.
  window.addEventListener("online", () => reportReachable(true));
}
