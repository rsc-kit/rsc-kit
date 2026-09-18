// Files that describe the app, found by name rather than configured.
//
// What actually goes wrong here is silence: a favicon named slightly wrong is
// simply not found, and the app has no favicon with nothing said. So these
// pin the names down, and pin down what each one produces.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allAppAssets, appAssets, headTags, typeOf } from "../../src/appAssets";

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

    expect(found.openGraph?.href).toBe("/_app/opengraph-image.png");
    expect(found.twitter?.href).toBe("/_app/twitter-image.jpg");
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

  test("a twitter image brings the card type with it", () => {
    // Without summary_large_image the image is shown as a thumbnail, which is
    // not what anyone who added one wanted.
    const tags = headTags(appAssets(appWith("twitter-image.png")));

    expect(tags).toContainEqual({
      tag: "meta",
      props: { name: "twitter:card", content: "summary_large_image" },
    });
  });

  test("share images are absolute when the app said where it lives", () => {
    // The og spec asks for an absolute url and several crawlers mean it. A
    // relative one is read by some and ignored by others, which is the worst
    // of both.
    const tags = headTags(
      appAssets(appWith("opengraph-image.png")),
      "https://orders.example.com",
    );

    expect(tags).toContainEqual({
      tag: "meta",
      props: {
        property: "og:image",
        content: "https://orders.example.com/_app/opengraph-image.png",
      },
    });
  });

  test("and relative when it did not, which beats omitting the tag", () => {
    const tags = headTags(appAssets(appWith("opengraph-image.png")));

    expect(tags[0].props.content).toBe("/_app/opengraph-image.png");
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
