// Which folder's image a route shows, and when an exported one beats it.
//
// The pure half of shareImages.test.ts, which builds an app and reads its
// head: here the rule alone, at the distances that decide it.

import { describe, expect, test } from "bun:test";
import { depthOf, fileWins, folderOf, nearestShareImage } from "../../src/shareImages";

describe("where a route file is", () => {
  test("the folder below app/, route groups kept", () => {
    expect(folderOf("app/page")).toBe("");
    expect(folderOf("app/layout")).toBe("");
    expect(folderOf("app/pricing/page")).toBe("pricing");
    expect(folderOf("app/(shop)/cart/[id]/page")).toBe("(shop)/cart/[id]");
  });

  test("and how deep that is", () => {
    expect(depthOf("")).toBe(0);
    expect(depthOf("pricing")).toBe(1);
    expect(depthOf("(shop)/cart/[id]")).toBe(3);
  });
});

describe("the nearest image", () => {
  const images = {
    "": { openGraph: "/_app/opengraph-image.png", twitter: "/_app/twitter-image.png" },
    blog: { openGraph: "/_app/blog/opengraph-image.png" },
    "blog/2026/launch": { openGraph: "/_app/blog/2026/launch/opengraph-image.png" },
  };

  test("is the route's own folder's", () => {
    expect(nearestShareImage(images, "blog", "openGraph")).toEqual({
      href: "/_app/blog/opengraph-image.png",
      depth: 1,
    });
  });

  test("or the nearest folder above, skipping the ones that have none", () => {
    expect(nearestShareImage(images, "blog/2026", "openGraph")?.href).toBe("/_app/blog/opengraph-image.png");
    expect(nearestShareImage(images, "blog/2026/launch/comments", "openGraph")?.depth).toBe(3);
  });

  test("falls to app/ itself, which is the site's", () => {
    expect(nearestShareImage(images, "pricing", "openGraph")).toEqual({
      href: "/_app/opengraph-image.png",
      depth: 0,
    });
  });

  test("is judged for each kind on its own", () => {
    expect(nearestShareImage(images, "blog", "twitter")?.href).toBe("/_app/twitter-image.png");
  });

  test("and is nothing when nothing was found", () => {
    expect(nearestShareImage({}, "blog", "openGraph")).toBeNull();
    expect(nearestShareImage({ blog: { twitter: "/x.png" } }, "blog", "openGraph")).toBeNull();
  });

  test("a folder is never mistaken for one that merely begins the same", () => {
    // blog2 is not inside blog.
    expect(nearestShareImage(images, "blog2", "openGraph")?.depth).toBe(0);
  });
});

describe("a file against an exported image", () => {
  test("the file, when nothing is exported", () => {
    expect(fileWins({ depth: 0 }, null)).toBe(true);
  });

  test("nothing, when there is no file", () => {
    expect(fileWins(null, { depth: 3 })).toBe(false);
    expect(fileWins(null, null)).toBe(false);
  });

  test("the nearer declaration wins", () => {
    // The page exports one and the site has a file: the page's.
    expect(fileWins({ depth: 0 }, { depth: 1 })).toBe(false);
    // The site's layout exports one and the page has a file beside it.
    expect(fileWins({ depth: 2 }, { depth: 0 })).toBe(true);
  });

  test("at the same distance, the file", () => {
    expect(fileWins({ depth: 1 }, { depth: 1 })).toBe(true);
  });
});
