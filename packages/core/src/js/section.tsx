import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { SlotBoundary } from "./SlotBoundary";

/**
 * Mark a region of a page as separately refreshable.
 *
 * Deliberately not a client module. The boundary it wraps things in is one,
 * but the things it wraps are server components — an async component that
 * fetches its own data. Marking this file "use client" would turn every one of
 * them into a client reference, which async components cannot be.
 *
 *     export default section('orders', async function Orders() { ... })
 *
 * The page renders it like any component. What it buys is a name the server
 * can address: `Rsc::revalidate('orders')` re-renders this and nothing else,
 * and the answer replaces it in place.
 *
 * The name has to be unique within the page. It does not have to be unique in
 * the app: the component is carried on the wrapper it returns, so the server
 * resolves a section through the module the route declares rather than by
 * looking the name up in a registry every section in the app also writes to.
 * Two pages may both call theirs 'stats'.
 */

/** Where the unwrapped component hangs off the wrapper section() returns. */
const INNER = Symbol.for('@rsc-kit/core.section-component');

export function section<P extends Record<string, unknown>>(
  name: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  // The boundary wraps the component here rather than at the call site, so a
  // page renders a section exactly like anything else.
  function Section(props: P): ReactNode {
    // createElement cannot line its overloads up with a component generic
    // over its own props. The call is the ordinary one.
    return createElement(
      SlotBoundary as ComponentType<{ name: string }>,
      { name },
      createElement(Component as ComponentType<never>, props as never),
    );
  }

  Section.displayName = `Section(${name})`;
  // Reached through the route's own module, never through a shared map.
  (Section as unknown as Record<symbol, unknown>)[INNER] = Component;

  return Section as ComponentType<P>;
}

/**
 * The component inside a section module, without its boundary.
 *
 * Revalidation renders this rather than the wrapper: the client swaps what is
 * inside the boundary, so returning the wrapper would nest a new boundary
 * inside the old one on every refresh.
 *
 * Takes the module's own export rather than a name. A name-keyed registry is
 * written to by every section in the app at bundle load — the generated entry
 * imports them all eagerly — so a lookup by name reached any page's region from
 * any url, bounded only by whatever guard happened to sit on the url asked for.
 */
export function sectionComponent(
  exported: unknown,
): ComponentType<Record<string, unknown>> | undefined {
  if (typeof exported !== 'function') return undefined;

  return (exported as unknown as Record<symbol, unknown>)[INNER] as
    | ComponentType<Record<string, unknown>>
    | undefined;
}
