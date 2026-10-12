// Which share image a route shows.
//
// An opengraph-image.png or twitter-image.png can sit in app/ itself or in any
// folder beneath it, and the nearest one to a route is the route's. A page
// that exports its own openGraph.images is a declaration too, and the nearer
// of the two wins - at the same distance the file does, which is Next's rule
// and the reason this one is not different.
//
// Kept apart from appAssets.ts, which reads the disk: this runs while a page
// renders, inside the bundle, and a module that imports node:fs does not
// belong there.

export type ShareKind = "openGraph" | "twitter";

/** The urls found, by the folder they sit in: "" is app/ itself. */
export type ShareImages = Record<string, Partial<Record<ShareKind, string>>>;

/** How far below app/ a folder is: "" is 0, "shop/cart" is 2. */
export function depthOf(folder: string): number {
  return folder === "" ? 0 : folder.split("/").length;
}

/**
 * The folder a route file lives in, below app/.
 *
 * Names are the build's: `app/(shop)/cart/page` is "(shop)/cart", and
 * `app/layout` is "". Route groups stay, because they are folders on disk and
 * a file in one is found by the folder it is in, not by the url it never shows.
 */
export function folderOf(component: string): string {
  return component.split("/").slice(1, -1).join("/");
}

/** The image in the nearest folder at or above `folder`, and how deep that folder is. */
export function nearestShareImage(
  images: ShareImages,
  folder: string,
  kind: ShareKind,
): { href: string; depth: number } | null {
  const parts = folder === "" ? [] : folder.split("/");

  for (let n = parts.length; n >= 0; n--) {
    const href = images[parts.slice(0, n).join("/")]?.[kind];

    if (href) return { href, depth: n };
  }

  return null;
}

/**
 * Whether the file is what the page shows, given the images its metadata
 * exports.
 *
 * The nearer declaration wins. Equal distance goes to the file: it is the more
 * specific thing to have done - a file beside the page is that page's card.
 */
export function fileWins(
  file: { depth: number } | null,
  exported: { depth: number } | null,
): boolean {
  if (!file) return false;
  if (!exported) return true;

  return file.depth >= exported.depth;
}
