"use client";

/**
 * Whether a newer build is live, and how to get it.
 *
 *     const { updated, reload } = useAppUpdate()
 *
 *     if (updated) return <button onClick={reload}>A new version is ready</button>
 *
 * Reported rather than acted on. Reloading out from under someone mid-form is
 * worse than the staleness it fixes, so this package will not do it for you —
 * what it will do is tell you, which nothing else can, because only the worker
 * knows a new version activated.
 */

import { useSyncExternalStore } from "react";
import { isUpdated, subscribeToUpdates, updatedOnServer } from "./updateStore";

export function useAppUpdate(): { updated: boolean; reload: () => void } {
  const updated = useSyncExternalStore(subscribeToUpdates, isUpdated, updatedOnServer);

  return {
    updated,
    // location.reload() rather than a router navigation: the point is to
    // re-fetch the document and its javascript, and a client navigation
    // deliberately does neither.
    reload: () => {
      if (typeof window !== "undefined") window.location.reload();
    },
  };
}
