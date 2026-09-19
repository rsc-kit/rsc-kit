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
 * and the engine renders the boundary a loading.tsx becomes through a
 * component named for it, so the frame just outside the nearest Suspense
 * is LoadingBoundary exactly when the boundary is the engine's. Only that
 * frame, and only that name: the check used to accept SegmentBoundary two
 * frames out, which held for a first render and misfired on a PPR resume,
 * where React leaves server components out of the stack and a developer's
 * own <Suspense> at the top of a page sat directly under the segment
 * boundary - a warning on every request that nothing could make go away.
 */
const ENGINE_BOUNDARY = /^\s*at LoadingBoundary\b/;

export function caughtByLoading(
  componentStack: string | null | undefined,
): boolean {
  const frames = (componentStack ?? "")
    .split("\n")
    .filter((line) => /^\s*at /.test(line));
  const at = frames.findIndex((line) => /^\s*at Suspense\b/.test(line));

  if (at === -1) return false;

  return ENGINE_BOUNDARY.test(frames[at + 1] ?? "");
}

/**
 * Whether a render error is the consumer cancelling, not the app failing.
 *
 * React's server renderer reports an abort as an error, and the reason it
 * gives when the stream was simply cancelled - a browser that left the page
 * mid-stream, a prefetch abandoned, a proxy that closed - is its own fixed
 * message. Logged, it reads as a fault in the page, and the page had none:
 * "[rsc-kit:ssr] Error: The render was aborted by the server without a
 * reason." on a dev console, every so often, for nothing. The same message
 * from the payload renderer means the same thing.
 */
const CANCELLED =
  /^The render was aborted by the server (?:without a reason|with a promise)\.$/;

export function cancelledByConsumer(error: unknown): boolean {
  if (error instanceof DOMException) return error.name === "AbortError";

  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : typeof error === "string"
        ? error
        : "";

  return CANCELLED.test(message);
}
