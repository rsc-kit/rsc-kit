"use client";

import { useEffect } from "react";
import { register } from "./watchStore";

/**
 * A rendered region's tags, handed to the tab's watcher.
 *
 * Renders nothing. Rendered by `Tagged` beside the region it describes, so
 * it arrives in the same payload - with the page, and again with the region
 * each time it is refreshed, carrying the versions that render saw.
 */
export function Watch({
  target,
  tags,
}: {
  target: string;
  tags: Record<string, [number, string]>;
}) {
  const key = JSON.stringify(tags);

  useEffect(
    () =>
      register({
        target,
        tags: JSON.parse(key) as Record<string, [number, string]>,
      }),
    [target, key],
  );

  return null;
}
