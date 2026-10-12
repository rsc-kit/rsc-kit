// Files that describe the app, found by name rather than configured.
//
//   src/app/
//     favicon.ico          <link rel="icon">
//     icon.png             <link rel="icon">, and the manifest's icons
//     icon-192.png         …as many as you like; sizes read from the name
//     apple-icon.png       <link rel="apple-touch-icon">
//     screenshot-wide-1280x720.png   the manifest's screenshots, for Chrome's
//     screenshot-narrow-750x1334.png richer install sheet; size and form
//                                    factor read from the name
//     apple-splash-1179x2556.png   <link rel="apple-touch-startup-image" media=…>
//                          …one per device and orientation; see appleSplash.ts
//     opengraph-image.png  <meta property="og:image">
//     twitter-image.png    <meta name="twitter:image">
//
// The two share images may also sit in any folder beneath app/, and are then
// the card for the routes under that folder - the nearest one wins. See
// shareImages.ts for the rule and appAssets() for the scan.
//
// The same bargain as every other file in this directory: put it where it
// belongs and it works, with nothing to register. Next established these names
// and there is nothing to gain by inventing different ones — an app moving
// between the two should not have to rename its favicon.
//
// They live in `app/` rather than `public/` on purpose. `public/` is "serve
// this verbatim"; these are read as well as served — an icon's size decides
// what goes in the manifest, and its presence decides what goes in the head.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isAppleSplash, splashMedia } from "./appleSplash.js";
import type { ShareImages, ShareKind } from "./shareImages.js";

/** One found file, and where it will be served from. */
export interface AppAsset {
  /** The file's name in the app directory. */
  file: string;
  /** The url it is served at. */
  href: string;
}

export interface AppAssets {
  favicon: AppAsset | null;
  icons: AppAsset[];
  appleIcon: AppAsset | null;
  /** For the manifest's screenshots: wide for desktop, narrow for a phone. */
  screenshots: AppAsset[];
  /** iOS launch screens, each with the media query its size maps to. */
  appleSplash: (AppAsset & { media: string | null })[];
  /**
   * Share images by the folder they sit in, "" being app/ itself. The route
   * that shows one is found by walking up from its own folder.
   */
  shareImages: Record<string, Partial<Record<ShareKind, AppAsset>>>;
}

const IMAGE = /\.(png|svg|jpg|jpeg|webp|gif|avif)$/i;

/**
 * Where these are served from.
 *
 * Their own directory rather than the output root, so an app that happens to
 * have a `public/icon.png` as well is not silently overwritten by one of
 * these, in either direction. The exception is the favicon, which browsers ask
 * for at `/favicon.ico` whatever any markup says.
 */
export const ASSET_BASE = "/_app";

/**
 * A file's path as a url path: each segment encoded, the slashes kept.
 *
 * A folder under app/ may be `[team]`, and a bracket is not legal in a url's
 * path - a strict scraper refuses the whole address, and a card with no image
 * is all it says. Everything a plain file name is made of passes through
 * untouched, so `icon-192.png` is `icon-192.png`.
 */
export function assetHref(file: string): string {
  return `${ASSET_BASE}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

/** The file path a url path names, which is what the build writes and the dev server reads. */
export function assetFile(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    // A stray % is not an encoding. Left as it came, it matches nothing.
    return href;
  }
}

function assetsIn(dir: string, match: (name: string) => boolean): AppAsset[] {
  return readdirSync(dir)
    .filter(match)
    .sort()
    .map((file) => ({ file, href: assetHref(file) }));
}

/** What the app declared by putting a file where it could be found. */
export function appAssets(appDir: string): AppAssets {
  if (!existsSync(appDir)) {
    return {
      favicon: null,
      icons: [],
      appleIcon: null,
      appleSplash: [],
      screenshots: [],
      shareImages: {},
    };
  }

  const names = readdirSync(appDir);
  const has = (name: string) => names.includes(name);

  return {
    // Served where a browser looks for it regardless of markup: a request for
    // /favicon.ico goes out whether or not a link tag exists, and answering it
    // from somewhere else means answering a 404 to the request that matters.
    favicon: has("favicon.ico")
      ? { file: "favicon.ico", href: "/favicon.ico" }
      : null,
    icons: assetsIn(
      appDir,
      (name) => /^icon[-\w]*/.test(name) && IMAGE.test(name),
    ),
    appleIcon:
      assetsIn(
        appDir,
        (name) => /^apple-icon[-\w]*/.test(name) && IMAGE.test(name),
      )[0] ?? null,
    screenshots: assetsIn(appDir, (name) =>
      /^screenshot-(wide|narrow)[-\w]*\.(png|jpe?g|webp)$/i.test(name),
    ),
    appleSplash: assetsIn(appDir, isAppleSplash).map((asset) => ({
      ...asset,
      media: splashMedia(asset.file),
    })),
    shareImages: shareImagesIn(appDir),
  };
}

const SHARE_FILES: Record<ShareKind, RegExp> = {
  openGraph: /^opengraph-image[-\w]*/,
  twitter: /^twitter-image[-\w]*/,
};

/**
 * Folders that are not part of the url tree, so a file in one answers no route:
 * private (`_x`), a parallel slot (`@x`), an interception (`(.)x`), dependencies
 * and anything hidden.
 */
function isRouteFolder(name: string): boolean {
  return !/^(?:[._@]|\(\.{1,3}\))/.test(name) && name !== "node_modules";
}

/**
 * Every share image under app/, by the folder it is in.
 *
 * A file in a folder is served from a path that keeps the folder, because two
 * folders may each have an opengraph-image.png and one flat /_app/ name would
 * make the second silently overwrite the first.
 */
function shareImagesIn(appDir: string): AppAssets["shareImages"] {
  const found: AppAssets["shareImages"] = {};

  const walk = (folder: string): void => {
    const dir = join(appDir, folder);
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const kind of Object.keys(SHARE_FILES) as ShareKind[]) {
      const name = entries
        .filter((e) => e.isFile() && SHARE_FILES[kind].test(e.name) && IMAGE.test(e.name))
        .map((e) => e.name)
        .sort()[0];

      if (name) {
        const file = folder === "" ? name : `${folder}/${name}`;

        (found[folder] ??= {})[kind] = { file, href: assetHref(file) };
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && isRouteFolder(entry.name)) {
        walk(folder === "" ? entry.name : `${folder}/${entry.name}`);
      }
    }
  };

  walk("");

  return found;
}

/** The urls only, which is all a page being rendered needs of them. */
export function shareImageUrls(assets: AppAssets): ShareImages {
  return Object.fromEntries(
    Object.entries(assets.shareImages).map(([folder, kinds]) => [
      folder,
      Object.fromEntries(
        Object.entries(kinds).map(([kind, asset]) => [kind, asset.href]),
      ),
    ]),
  );
}

export function typeOf(file: string): string {
  const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();

  return extension === "svg"
    ? "image/svg+xml"
    : extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "ico"
        ? "image/x-icon"
        : `image/${extension}`;
}

/** Every asset found, favicon first: what the build copies and the dev server answers. */
export function allAppAssets(assets: AppAssets): AppAsset[] {
  return [
    ...(assets.favicon ? [assets.favicon] : []),
    ...assets.icons,
    ...(assets.appleIcon ? [assets.appleIcon] : []),
    ...assets.appleSplash,
    ...assets.screenshots,
    ...Object.values(assets.shareImages).flatMap((kinds) => Object.values(kinds)),
  ];
}

/**
 * The head tags these produce, as plain data the generated entry turns into
 * elements - the same on every page. The share images are not here: which one
 * a page shows depends on where the page is, and that is decided as it renders.
 */
export function headTags(
  assets: AppAssets,
): { tag: "link" | "meta"; props: Record<string, string> }[] {
  const tags: { tag: "link" | "meta"; props: Record<string, string> }[] = [];

  if (assets.favicon) {
    tags.push({
      tag: "link",
      props: { rel: "icon", href: assets.favicon.href, type: "image/x-icon" },
    });
  }

  for (const icon of assets.icons) {
    // A maskable icon is for a launcher, padded for its mask; as a tab's icon
    // it would be the small one. It goes in the manifest and nowhere else.
    if (/(^|-)maskable\b/i.test(icon.file)) continue;

    tags.push({
      tag: "link",
      props: { rel: "icon", href: icon.href, type: typeOf(icon.file) },
    });
  }

  if (assets.appleIcon) {
    tags.push({
      tag: "link",
      props: { rel: "apple-touch-icon", href: assets.appleIcon.href },
    });
  }

  // Only the sizes a device has: a query that matches nothing is bytes in
  // every page for no one, and the build names those files instead.
  const splashes = assets.appleSplash.filter((splash) => splash.media !== null);

  for (const splash of splashes) {
    tags.push({
      tag: "link",
      props: { rel: "apple-touch-startup-image", href: splash.href, media: splash.media! },
    });
  }

  // Safari shows a launch screen only to an app launched from the home
  // screen as an app. Whoever put these in app/ meant that.
  if (splashes.length > 0) {
    tags.push({ tag: "meta", props: { name: "mobile-web-app-capable", content: "yes" } });
    tags.push({ tag: "meta", props: { name: "apple-mobile-web-app-capable", content: "yes" } });
  }

  return tags;
}
