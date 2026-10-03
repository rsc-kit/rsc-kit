import { Suspense, createElement } from "react";
import type { ReactNode } from "react";
import { currentPageProps } from "../request";
import { sign, versionSource } from "../changed";
import type { SignedName } from "../changed";
import { Changes } from "./Changes";

/** What a section or page refreshes on: names, or a function of its props that makes them. */
export type RefreshOnList<P> =
  string[] | ((props: P) => string[] | Promise<string[]>);

/**
 * The names a region refreshes on, read for this render and signed for the tab.
 *
 * A server component, rendered beside the region: it works out the names
 * from the props, asks the source what version each is at, and hands them to
 * the client as `Changes`. Under its own Suspense boundary, so the ask never
 * holds up the region's paint - the data is what the visitor is waiting on,
 * not the version numbers behind it.
 *
 * Renders nothing when the source cannot answer - a backend that is down
 * for this one call. The region still renders; it just does not refresh on
 * its names until the next time it is rendered.
 */
export function RefreshOn<P>({
  target,
  refreshOn,
  props,
}: {
  target: string;
  refreshOn: RefreshOnList<P>;
  props: P;
}): ReactNode {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(Resolve as never, { target, refreshOn, props }),
  );
}

const warned = new Set<string>();

/**
 * Never throws. An error here would become an error row inside the region's
 * payload, and the browser decodes that as the region failing - a blank
 * document for a version lookup that did not go through. Said once per
 * region instead, and the region renders without refreshing on anything.
 */
async function Resolve<P>({
  target,
  refreshOn,
  props,
}: {
  target: string;
  refreshOn: RefreshOnList<P>;
  props: P;
}): Promise<ReactNode> {
  try {
    // The page's params and searchParams, under whatever the page passed: a
    // section rendered by its page is given nothing, and alone is given these.
    const input = { ...currentPageProps(), ...(props as object) } as P;
    const named =
      typeof refreshOn === "function" ? await refreshOn(input) : refreshOn;
    const unique = [...new Set(named)].filter(
      (name) => typeof name === "string" && name !== "",
    );

    if (unique.length === 0) return null;

    // -1 is a version nothing is at, so every name comes back with its current version.
    const versions = await versionSource().changed(
      Object.fromEntries(unique.map((name) => [name, -1])),
      0,
    );
    const signed: Record<string, SignedName> = {};

    for (const name of unique)
      signed[name] = [versions[name] ?? 0, await sign(name)];

    return createElement(Changes, { target, names: signed });
  } catch (error) {
    if (!warned.has(target)) {
      warned.add(target);
      console.warn(
        `[rsc-kit] what ${JSON.stringify(target)} refreshes on could not be read, so it will not: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    return null;
  }
}
