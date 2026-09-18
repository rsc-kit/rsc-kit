/**
 * Whether a read React caught at a boundary fell through to a loading.tsx.
 *
 * A component that reads the query string under a <Suspense> the developer
 * wrote is the designed path: the fallback is stored, the browser fills it,
 * and nothing needs saying. The same read with nothing closer than a
 * loading.tsx - a boundary the engine put there for the whole segment - is
 * worth a line, because the whole segment shows the fallback until the query
 * arrives, and a boundary closer to the read would keep the rest painted.
 *
 * The component stack says which: frames run from the component outward,
 * and the engine's segment boundaries render through SegmentBoundary or
 * SlotBoundary, so the frame just outside the nearest Suspense tells whose
 * it is. Only development has the stack; production reports nothing here,
 * and the build's own note or warning on the route is the record.
 */
const ENGINE_BOUNDARY = /^\s*at (SegmentBoundary|SlotBoundary)\b/;

export function caughtByLoading(
  componentStack: string | null | undefined,
): boolean {
  const frames = (componentStack ?? "")
    .split("\n")
    .filter((line) => /^\s*at /.test(line));
  const at = frames.findIndex((line) => /^\s*at Suspense\b/.test(line));

  if (at === -1) return false;

  return frames
    .slice(at + 1, at + 3)
    .some((line) => ENGINE_BOUNDARY.test(line));
}
