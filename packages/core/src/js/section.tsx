import { Fragment, createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { SlotBoundary } from "./SlotBoundary";
import { RefreshOn } from "./refreshOn";
import type { RefreshOnList } from "./refreshOn";
import type { PageProps } from "../routeSchema";

export type { RefreshOnInput, RefreshOnList } from "./refreshOn";

/**
 * A page's `export const refreshOn`, typed from its own url schemas:
 *
 *     export const params = z.object({ team: z.string() })
 *     export const refreshOn: PageRefreshOn<typeof params> = ({ params }) => [`team:${params.team}:repos`]
 *
 * `params` arrives awaited and parsed; without schemas, it is a record of strings.
 */
export type PageRefreshOn<P = never, S = never> = RefreshOnList<PageProps<P, S>>;

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
 * With `refreshOn`, it also says what it depends on, and refreshes itself when
 * that changes - from a webhook, a job, another visitor - with nothing polling:
 *
 *     export default section('repos', Repos, {
 *       refreshOn: ({ params }) => [`team:${params.team}:repos`],
 *     })
 *
 * The name has to be unique within the page. It does not have to be unique in
 * the app: the component is carried on the wrapper it returns, so the server
 * resolves a section through the module the route declares rather than by
 * looking the name up in a registry every section in the app also writes to.
 * Two pages may both call theirs 'stats'.
 */

/** Where the unwrapped component hangs off the wrapper section() returns. */
const INNER = Symbol.for("@rsc-kit/core.section-component");

/** Set on the wrapper of a section declared `shared`. */
const SHARED = Symbol.for("@rsc-kit/core.section-shared");

export interface SectionOptions<P> {
  /**
   * What this section refreshes on: names for the data it shows, or a
   * function of the section's props - the page's params and searchParams -
   * that makes them. When one is said to have changed, the section refreshes.
   */
  refreshOn?: RefreshOnList<P>;
  /**
   * The section renders the same for everyone allowed to see the page, so
   * when a change makes many tabs ask for it, one render answers them all.
   * Each tab's guards still run on its own request; only the render is
   * shared. Never set it on a section that shows anything per visitor - their
   * name, their data, what they may do: the first tab's render is what every
   * other tab is shown.
   */
  shared?: boolean;
}

export function section<P extends Record<string, unknown>>(
  name: string,
  Component: ComponentType<P>,
  options: SectionOptions<P> = {},
): ComponentType<P> {
  const { refreshOn } = options;

  // The names render inside the boundary, with the component, so a refresh -
  // which renders the inside alone - carries the versions it saw.
  const Inner: ComponentType<P> = refreshOn
    ? function RefreshOnSection(props: P): ReactNode {
        return createElement(
          Fragment,
          null,
          createElement(
            RefreshOn as ComponentType<never>,
            { key: "refreshOn", target: name, refreshOn, props } as never,
          ),
          createElement(
            Component as ComponentType<never>,
            { key: "section", ...(props as object) } as never,
          ),
        );
      }
    : Component;

  // The boundary wraps the component here rather than at the call site, so a
  // page renders a section exactly like anything else.
  function Section(props: P): ReactNode {
    // createElement cannot line its overloads up with a component generic
    // over its own props. The call is the ordinary one.
    return createElement(
      SlotBoundary as ComponentType<{ name: string }>,
      { name },
      createElement(Inner as ComponentType<never>, props as never),
    );
  }

  Section.displayName = `Section(${name})`;
  // Reached through the route's own module, never through a shared map.
  (Section as unknown as Record<symbol, unknown>)[INNER] = Inner;
  if (options.shared)
    (Section as unknown as Record<symbol, unknown>)[SHARED] = true;

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
  if (typeof exported !== "function") return undefined;

  return (exported as unknown as Record<symbol, unknown>)[INNER] as
    ComponentType<Record<string, unknown>> | undefined;
}

/** Whether a section module's export was declared `shared`. */
export function isSharedSection(exported: unknown): boolean {
  return (
    typeof exported === "function" &&
    (exported as unknown as Record<symbol, unknown>)[SHARED] === true
  );
}
