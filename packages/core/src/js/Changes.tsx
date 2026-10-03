"use client";

import { useEffect } from "react";
import { register } from "./changesStore";

/**
 * What a rendered region is live on, handed to the tab's watcher.
 *
 * Renders nothing. Rendered by `RefreshOn` beside the region it describes,
 * so it arrives in the same payload - with the page, and again with the
 * region each time it is refreshed, carrying the versions that render saw.
 */
export function Changes({
  target,
  names,
}: {
  target: string;
  names: Record<string, [number, string]>;
}) {
  const key = JSON.stringify(names);

  useEffect(
    () =>
      register({
        target,
        names: JSON.parse(key) as Record<string, [number, string]>,
      }),
    [target, key],
  );

  return null;
}
