import { Suspense, createElement } from "react";
import type { ReactNode } from "react";
import { connection, currentPageProps } from "../request";
import { sign, versionSource } from "../changed";
import type { SignedName } from "../changed";
import { Changes } from "./Changes";

/** A prop as it arrives awaited: a page's `params` is a promise of them. */
type Awaited_<T, Else> = [T] extends [never]
  ? Else
  : unknown extends T
    ? Else // props that do not say: a section's own, with no params among them
    : T extends Promise<infer V>
      ? V
      : T extends undefined
        ? Else
        : T;

/**
 * What a refreshOn function is given: the page's params and search params,
 * already awaited, beside whatever props the section was rendered with.
 *
 * Typed from P when it says what they are - a page's `PageProps<typeof
 * params>` - so `params.team` is the schema's type, not a string by hand.
 */
export type RefreshOnInput<P> = Omit<P, "params" | "searchParams"> & {
  params: Awaited_<P extends { params?: infer A } ? A : never, Record<string, string>>;
  searchParams: Awaited_<
    P extends { searchParams?: infer S } ? S : never,
    URLSearchParams | Record<string, unknown>
  >;
};

/** What a section or page refreshes on: names, or a function of its props that makes them. */
export type RefreshOnList<P> =
  string[] | ((input: RefreshOnInput<P>) => string[] | Promise<string[]>);

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

/** Where createTestApp's watched() collects what a render's regions refresh on. */
export const WATCHED = Symbol.for("rsc-kit.test-watched");

const warned = new Set<string>();
const emptyWarned = new Set<string>();

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
    // Per request, never at build. A version read at build is stale by the
    // time anyone loads the page, and a name signed at build is signed with
    // whatever key the build machine had. At build this suspends and the
    // names become a hole in the stored shell, filled per request.
    await connection();

    // The page's params and searchParams, under whatever the page passed: a
    // section rendered by its page is given nothing, and alone is given these.
    const given = { ...currentPageProps(), ...(props as object) } as Record<
      string,
      unknown
    >;

    // Awaited here, so `({ params }) => [\`team:${params.team}\`]` - the way
    // anyone writes it - means the team. A page's params and search params
    // are promises, and read without awaiting they made `team:undefined`:
    // one name for every team, so each refreshed on all the others' changes.
    // Awaiting costs nothing here; the names are made per request anyway.
    const input = {
      ...given,
      params: ((await given.params) ?? {}) as Record<string, string>,
      searchParams: ((await given.searchParams) ??
        new URLSearchParams()) as URLSearchParams,
    } as RefreshOnInput<P>;
    const unique = await namesFor(target, refreshOn, input);

    // A test asking what this page watches - createTestApp's watched() - is
    // told here, rather than left to dig the signed names out of the payload.
    const recording = (globalThis as { [WATCHED]?: Record<string, string[]> })[WATCHED];

    if (recording) recording[target] = unique;

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

/**
 * The names a region refreshes on, for this render: its list, or what its
 * function made of the input - unique, and only non-empty strings. Warns in
 * development when that is none at all.
 */
export async function namesFor<P>(
  target: string,
  refreshOn: RefreshOnList<P>,
  input: RefreshOnInput<P>,
): Promise<string[]> {
  const named =
    typeof refreshOn === "function" ? await refreshOn(input) : refreshOn;
  const unique = [...new Set(named)].filter(
    (name) => typeof name === "string" && name !== "",
  );

  if (unique.length === 0) {
    // Usually a mistake that looks like working code - a param read under
    // the wrong name, a list built from an empty query - and the region
    // then refreshes on nothing. Said in development, once per region; a
    // region that means to watch nothing for some visitors can ignore it.
    if (
      (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
        ?.NODE_ENV !== "production" &&
      !emptyWarned.has(target)
    ) {
      emptyWarned.add(target);
      console.warn(
        `[rsc-kit] ${JSON.stringify(target)}'s refreshOn gave no names, so it refreshes on nothing. ` +
          "Check what it reads - a param under another name is undefined.",
      );
    }

    return [];
  }

  return unique;
}
