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
 * The name has to be unique within the page, since that is all the server has
 * to go on.
 */

/** Named regions, so the server can render one without its page. */
const sections = new Map<string, ComponentType<Record<string, unknown>>>();

export function section<P extends Record<string, unknown>>(
  name: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  sections.set(name, Component as ComponentType<Record<string, unknown>>);

  // The boundary wraps the component here rather than at the call site, so a
  // page renders a section exactly like anything else.
  function Section(props: P): ReactNode {
    return createElement(SlotBoundary, { name }, createElement(Component, props));
  }

  Section.displayName = `Section(${name})`;

  return Section as ComponentType<P>;
}

/**
 * The component behind a name, without its boundary.
 *
 * Revalidation renders this rather than the wrapper: the client swaps what is
 * inside the boundary, so returning the wrapper would nest a new boundary
 * inside the old one on every refresh.
 */
export function sectionComponent(name: string): ComponentType<Record<string, unknown>> | undefined {
  return sections.get(name);
}

/** Every name registered, for an error that can say what does exist. */
export function sectionNames(): string[] {
  return [...sections.keys()];
}
