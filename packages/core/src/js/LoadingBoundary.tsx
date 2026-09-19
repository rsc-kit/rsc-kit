"use client";

// The engine's own Suspense: the one a loading.tsx becomes.
//
// A component, and a named one, for the report and nothing else. When a read
// is caught at a boundary during a server render, the component stack says
// whose boundary it was - and the stack is the only thing that does. It
// used to be inferred from what stood two frames outside the nearest
// Suspense, which held for a first render and broke on a PPR resume: React
// leaves server components out of that stack, so a <Suspense> the developer
// wrote as the first thing in a page sat directly under the engine's
// segment boundary and was reported as a loading.tsx catching the whole
// segment - a warning nobody could make go away, on every request. Now the
// engine's boundary is the one rendered by LoadingBoundary, and only that.
import { Suspense, type ReactNode } from "react";

export function LoadingBoundary({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
