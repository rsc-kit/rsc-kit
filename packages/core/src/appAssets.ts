// Files that describe the app, found by name rather than configured.
//
//   src/app/
//     favicon.ico          <link rel="icon">
//     icon.png             <link rel="icon">, and the manifest's icons
//     icon-192.png         …as many as you like; sizes read from the name
//     apple-icon.png       <link rel="apple-touch-icon">
//     opengraph-image.png  <meta property="og:image">
//     twitter-image.png    <meta name="twitter:image">
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
  openGraph: AppAsset | null;
  twitter: AppAsset | null;
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

function assetsIn(dir: string, match: (name: string) => boolean): AppAsset[] {
  return readdirSync(dir)
    .filter(match)
    .sort()
    .map((file) => ({ file, href: `${ASSET_BASE}/${file}` }));
}

/** What the app declared by putting a file where it could be found. */
export function appAssets(appDir: string): AppAssets {
  if (!existsSync(appDir)) {
    return {
      favicon: null,
      icons: [],
      appleIcon: null,
      openGraph: null,
      twitter: null,
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
    openGraph:
      assetsIn(
        appDir,
        (name) => /^opengraph-image[-\w]*/.test(name) && IMAGE.test(name),
      )[0] ?? null,
    twitter:
      assetsIn(
        appDir,
        (name) => /^twitter-image[-\w]*/.test(name) && IMAGE.test(name),
      )[0] ?? null,
  };
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

/** The head tags these produce, as plain data the generated entry turns into elements. */
/** Every asset found, favicon first: what the build copies and the dev server answers. */
export function allAppAssets(assets: AppAssets): AppAsset[] {
  return [
    ...(assets.favicon ? [assets.favicon] : []),
    ...assets.icons,
    ...(assets.appleIcon ? [assets.appleIcon] : []),
    ...(assets.openGraph ? [assets.openGraph] : []),
    ...(assets.twitter ? [assets.twitter] : []),
  ];
}

export function headTags(
  assets: AppAssets,
  origin?: string,
): { tag: "link" | "meta"; props: Record<string, string> }[] {
  const tags: { tag: "link" | "meta"; props: Record<string, string> }[] = [];

  if (assets.favicon) {
    tags.push({
      tag: "link",
      props: { rel: "icon", href: assets.favicon.href, type: "image/x-icon" },
    });
  }

  for (const icon of assets.icons) {
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

  // Absolute when the app said where it lives. The og spec asks for an absolute
  // url and several crawlers still mean it — a relative one is read by some and
  // ignored by others, which is the worst of both. Relative is what is left
  // when nothing said, and is better than omitting the tag.
  const absolute = (href: string) =>
    origin ? new URL(href, origin).href : href;

  if (assets.openGraph) {
    tags.push({
      tag: "meta",
      props: { property: "og:image", content: absolute(assets.openGraph.href) },
    });
  }

  if (assets.twitter) {
    tags.push({
      tag: "meta",
      props: { name: "twitter:image", content: absolute(assets.twitter.href) },
    });
    tags.push({
      tag: "meta",
      props: { name: "twitter:card", content: "summary_large_image" },
    });
  }

  return tags;
}
