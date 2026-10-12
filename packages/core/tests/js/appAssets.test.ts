// Files that describe the app, found by name rather than configured.
//
// What actually goes wrong here is silence: a favicon named slightly wrong is
// simply not found, and the app has no favicon with nothing said. So these
// pin the names down, and pin down what each one produces.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allAppAssets, appAssets, assetFile, assetHref, headTags, shareImageUrls, typeOf } from "../../src/appAssets";

const appWith = (...names: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), "assets-"));

  for (const name of names) writeFileSync(join(dir, name), "");

  return dir;
};

describe("what the build finds", () => {
  test("a favicon, at the url a browser asks for regardless of markup", () => {
    // /favicon.ico is requested whether or not a link tag exists. Serving it
    // from anywhere else means answering a 404 to the request that matters.
    expect(appAssets(appWith("favicon.ico")).favicon).toEqual({
      file: "favicon.ico",
      href: "/favicon.ico",
    });
  });

  test("icons, however many, in a stable order", () => {
    const found = appAssets(
      appWith("icon-512.png", "icon-192.png", "icon.svg"),
    );

    expect(found.icons.map((i) => i.file)).toEqual([
      "icon-192.png",
      "icon-512.png",
      "icon.svg",
    ]);
  });

  test("an apple icon, which is not one of them", () => {
    // apple-icon would match a loose icon* pattern and end up in the manifest,
    // where it does not belong — it is a different size convention.
    const found = appAssets(appWith("icon-192.png", "apple-icon.png"));

    expect(found.icons.map((i) => i.file)).toEqual(["icon-192.png"]);
    expect(found.appleIcon?.file).toBe("apple-icon.png");
  });

  test("share images", () => {
    const found = appAssets(
      appWith("opengraph-image.png", "twitter-image.jpg"),
    );

    expect(found.shareImages[""]?.openGraph?.href).toBe("/_app/opengraph-image.png");
    expect(found.shareImages[""]?.twitter?.href).toBe("/_app/twitter-image.jpg");
  });

  test("share images in the folders beneath, each at a path that keeps its folder", () => {
    // Two folders may each have an opengraph-image.png. One flat name would
    // make the second overwrite the first in the build, with nothing said.
    const dir = appWith("opengraph-image.png");

    for (const folder of ["pricing", "(shop)/cart", "[team]"]) {
      mkdirSync(join(dir, folder), { recursive: true });
      writeFileSync(join(dir, folder, "opengraph-image.png"), "");
    }

    const found = appAssets(dir).shareImages;

    expect(Object.keys(found).sort()).toEqual(["", "(shop)/cart", "[team]", "pricing"]);
    expect(found["pricing"]?.openGraph).toEqual({
      file: "pricing/opengraph-image.png",
      href: "/_app/pricing/opengraph-image.png",
    });
    expect(found["(shop)/cart"]?.openGraph?.href).toBe("/_app/(shop)/cart/opengraph-image.png");
    // A bracket is not legal in a url's path: the tag carries it encoded, and
    // the file it names is still the one on disk.
    const team = allAppAssets(appAssets(dir)).find((a) => a.file === "[team]/opengraph-image.png");

    expect(team?.href).toBe("/_app/%5Bteam%5D/opengraph-image.png");
    expect(assetFile(team!.href)).toBe("/_app/[team]/opengraph-image.png");
  });

  test("a url path and the file it names, both ways", () => {
    expect(assetHref("icon-192.png")).toBe("/_app/icon-192.png");
    expect(assetHref("(shop)/cart/opengraph-image.png")).toBe("/_app/(shop)/cart/opengraph-image.png");
    expect(assetHref("a b/c#d/e.png")).toBe("/_app/a%20b/c%23d/e.png");
    // Either spelling reaches the same file, and a stray % reaches nothing.
    expect(assetFile("/_app/%5Bx%5D/i.png")).toBe(assetFile("/_app/[x]/i.png"));
    expect(assetFile("/_app/100%/i.png")).toBe("/_app/100%/i.png");
  });

  test("and not in folders that answer no route", () => {
    // A private folder, a parallel slot, an interception and dependencies are
    // not url segments. An image in one is not a card for anything.
    const dir = appWith();

    for (const folder of ["_private", "@modal", "(.)photo", "node_modules", ".hidden"]) {
      mkdirSync(join(dir, folder), { recursive: true });
      writeFileSync(join(dir, folder, "opengraph-image.png"), "");
    }

    expect(appAssets(dir).shareImages).toEqual({});
  });

  test("shareImageUrls hands a page the urls and nothing else", () => {
    const dir = appWith("twitter-image.png");

    mkdirSync(join(dir, "blog"));
    writeFileSync(join(dir, "blog", "opengraph-image.jpg"), "");

    expect(shareImageUrls(appAssets(dir))).toEqual({
      "": { twitter: "/_app/twitter-image.png" },
      blog: { openGraph: "/_app/blog/opengraph-image.jpg" },
    });
  });

  test("and nothing at all is not an error", () => {
    expect(appAssets(appWith("page.tsx", "layout.tsx")).icons).toEqual([]);
    expect(
      appAssets(join(tmpdir(), "does-not-exist-at-all")).favicon,
    ).toBeNull();
  });

  test("a route file is never mistaken for an asset", () => {
    // icon.tsx is a component someone wrote, not an image.
    expect(appAssets(appWith("icon.tsx")).icons).toEqual([]);
  });
});

describe("what goes in the head", () => {
  test("each icon with its own media type", () => {
    const tags = headTags(appAssets(appWith("icon.svg", "icon-192.png")));

    expect(tags).toContainEqual({
      tag: "link",
      props: { rel: "icon", href: "/_app/icon.svg", type: "image/svg+xml" },
    });
    expect(tags).toContainEqual({
      tag: "link",
      props: { rel: "icon", href: "/_app/icon-192.png", type: "image/png" },
    });
  });

  test("share images are not here, because which one a page shows depends on the page", () => {
    // They are decided as a page renders - see shareImages.ts and
    // shareImages.test.ts, which builds an app and reads the head.
    expect(headTags(appAssets(appWith("opengraph-image.png", "twitter-image.png")))).toEqual([]);
  });

  test("nothing found means nothing emitted", () => {
    expect(headTags(appAssets(appWith("page.tsx")))).toEqual([]);
  });
});

describe("what the dev server answers", () => {
  // The build copies these beside the client output; while developing there
  // is no output, so the dev server serves the same list from app/ at the
  // same hrefs. One list, or the two drift and an icon shows only after a
  // build.
  test("every asset found, favicon first, at the href the head tag carries", () => {
    const found = appAssets(
      appWith(
        "favicon.ico",
        "icon.png",
        "apple-icon.png",
        "opengraph-image.png",
        "page.tsx",
      ),
    );
    const all = allAppAssets(found);

    expect(all.map((a) => a.href)).toEqual([
      "/favicon.ico",
      "/_app/icon.png",
      "/_app/apple-icon.png",
      "/_app/opengraph-image.png",
    ]);
    expect(all.map((a) => typeOf(a.file))).toEqual([
      "image/x-icon",
      "image/png",
      "image/png",
      "image/png",
    ]);
  });
});

describe("iOS launch screens, named by their size", () => {
  test("each becomes a link with the media query of the device its size names", () => {
    const tags = headTags(appAssets(appWith("apple-splash-1179x2556.png", "apple-splash-2556x1179.png")));

    expect(tags).toContainEqual({
      tag: "link",
      props: {
        rel: "apple-touch-startup-image",
        href: "/_app/apple-splash-1179x2556.png",
        media:
          "screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
    });
    // Landscape is the same device turned round: iOS reports its size in
    // portrait either way.
    expect(tags).toContainEqual({
      tag: "link",
      props: {
        rel: "apple-touch-startup-image",
        href: "/_app/apple-splash-2556x1179.png",
        media:
          "screen and (device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)",
      },
    });
  });

  test("and says the app launches as one, which is when Safari shows them", () => {
    const tags = headTags(appAssets(appWith("apple-splash-1179x2556.png")));

    expect(tags).toContainEqual({ tag: "meta", props: { name: "apple-mobile-web-app-capable", content: "yes" } });
    expect(tags).toContainEqual({ tag: "meta", props: { name: "mobile-web-app-capable", content: "yes" } });
  });

  test("a size no device has is served but linked from nowhere", () => {
    // A query that matches nothing is bytes in every page for no one; the
    // build names the file instead.
    const found = appAssets(appWith("apple-splash-1000x2000.png"));

    expect(found.appleSplash).toEqual([{ file: "apple-splash-1000x2000.png", href: "/_app/apple-splash-1000x2000.png", media: null }]);
    expect(headTags(found).filter((t) => t.props.rel === "apple-touch-startup-image")).toEqual([]);
    expect(headTags(found).some((t) => t.props.name === "apple-mobile-web-app-capable")).toBe(false);
  });

  test("copied with the other assets, and not mistaken for an icon", () => {
    const found = appAssets(appWith("icon-512.png", "apple-icon.png", "apple-splash-1179x2556.png"));

    expect(found.icons.map((i) => i.file)).toEqual(["icon-512.png"]);
    expect(allAppAssets(found).map((a) => a.file)).toContain("apple-splash-1179x2556.png");
  });

  test("an app with none pays nothing", () => {
    const tags = headTags(appAssets(appWith("icon-192.png")));

    expect(tags.some((t) => t.props.rel === "apple-touch-startup-image" || t.props.name === "apple-mobile-web-app-capable")).toBe(false);
  });
});

describe("a maskable icon", () => {
  test("goes in the manifest and not in the head, where it would be the shrunk one", () => {
    const found = appAssets(appWith("icon-192.png", "icon-maskable-512.png"));

    expect(found.icons.map((i) => i.file)).toEqual(["icon-192.png", "icon-maskable-512.png"]);
    expect(headTags(found).filter((t) => t.props.rel === "icon").map((t) => t.props.href)).toEqual(["/_app/icon-192.png"]);
  });
});

describe("screenshots, for Chrome's richer install sheet", () => {
  test("found by name, served, and kept out of the head", () => {
    const found = appAssets(appWith("screenshot-wide-1280x720.png", "screenshot-narrow-750x1334.webp", "screenshots.txt"));

    expect(found.screenshots.map((s) => s.file)).toEqual(["screenshot-narrow-750x1334.webp", "screenshot-wide-1280x720.png"]);
    expect(allAppAssets(found).map((a) => a.file)).toContain("screenshot-wide-1280x720.png");
    expect(headTags(found).some((t) => String(t.props.href ?? "").includes("screenshot"))).toBe(false);
  });

  test("and not mistaken for an icon", () => {
    expect(appAssets(appWith("screenshot-wide-1280x720.png")).icons).toEqual([]);
  });
});
