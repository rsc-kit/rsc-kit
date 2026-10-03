import { Suspense, createElement } from "react";
import type { ReactNode } from "react";
import { currentPageProps } from "../request";
import { sign, tagSource } from "../tags";
import type { SignedTag } from "../tags";
import { Watch } from "./Watch";

/** What a section or page declares: tag names, or a function of its props that names them. */
export type Tags<P> = string[] | ((props: P) => string[] | Promise<string[]>);

/**
 * A region's tags, read for this render and signed for the tab.
 *
 * A server component, rendered beside the region: it works out the tags from
 * the props, asks the source what version each is at, and hands them to the
 * client as a `Watch`. Under its own Suspense boundary, so the ask never
 * holds up the region's paint - the data is what the visitor is waiting on,
 * not the version numbers behind it.
 *
 * Renders nothing when the source cannot answer - a backend that is down
 * for this one call. The region still renders; it just is not watched until
 * the next time it is.
 */
export function Tagged<P>({
  target,
  tags,
  props,
}: {
  target: string;
  tags: Tags<P>;
  props: P;
}): ReactNode {
  return createElement(
    Suspense,
    { fallback: null },
    createElement(Resolve as never, { target, tags, props }),
  );
}

const warned = new Set<string>();

/**
 * Never throws. An error here would become an error row inside the region's
 * payload, and the browser decodes that as the region failing - a blank
 * document for a version lookup that did not go through. Said once per
 * region instead, and the region renders unwatched.
 */
async function Resolve<P>({
  target,
  tags,
  props,
}: {
  target: string;
  tags: Tags<P>;
  props: P;
}): Promise<ReactNode> {
  try {
    // The page's params and searchParams, under whatever the page passed: a
    // section rendered by its page is given nothing, and alone is given these.
    const input = { ...currentPageProps(), ...(props as object) } as P;
    const named = typeof tags === "function" ? await tags(input) : tags;
    const unique = [...new Set(named)].filter(
      (tag) => typeof tag === "string" && tag !== "",
    );

    if (unique.length === 0) return null;

    // -1 is a version nothing is at, so every tag comes back with its current one.
    const versions = await tagSource().changed(
      Object.fromEntries(unique.map((tag) => [tag, -1])),
      0,
    );
    const signed: Record<string, SignedTag> = {};

    for (const tag of unique)
      signed[tag] = [versions[tag] ?? 0, await sign(tag)];

    return createElement(Watch, { target, tags: signed });
  } catch (error) {
    if (!warned.has(target)) {
      warned.add(target);
      console.warn(
        `[rsc-kit] the tags of ${JSON.stringify(target)} could not be read, so it is not watched: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }

    return null;
  }
}
