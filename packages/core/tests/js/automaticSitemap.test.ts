import { describe, expect, test } from "bun:test";

import { automaticSitemap } from "../../src/metadataRoutes";

/**
 * The sitemap the build writes when the app wrote none: what it stored and
 * what it was told about, minus what a crawler should not be sent to.
 */
const built = new Date("2026-09-18T12:00:00Z");

const routes = [
  { component: "app/page", middleware: [] },
  { component: "app/pricing/page", middleware: [] },
  { component: "app/account/page", middleware: ["app/account/middleware"] },
  { component: "app/photo/[id]/page", middleware: [] },
  { component: "app/not-found", middleware: [] },
];

describe("the automatic sitemap", () => {
  test("lists stored pages with the build as lastModified, and listed params as urls", () => {
    const xml = automaticSitemap(
      [
        { url: "/", type: "frozen", component: "app/page" },
        { url: "/pricing", type: "shell", component: "app/pricing/page" },
        { url: "/photo/1", type: "frozen", component: "app/photo/[id]/page" },
        { url: "/photo/2", type: "frozen", component: "app/photo/[id]/page" },
      ],
      routes,
      "https://example.com",
      built,
    );

    expect(xml).toContain(
      "<loc>https://example.com/</loc><lastmod>2026-09-18T12:00:00.000Z</lastmod>",
    );
    expect(xml).toContain("<loc>https://example.com/pricing</loc>");
    expect(xml).toContain("<loc>https://example.com/photo/1</loc>");
    expect(xml).toContain("<loc>https://example.com/photo/2</loc>");
    expect(xml.split("<url>").length - 1).toBe(4);
  });

  test("leaves out a guarded route, a failed one, a pattern, and the not-found page", () => {
    const xml = automaticSitemap(
      [
        { url: "/", type: "frozen", component: "app/page" },
        { url: "/account", type: "dynamic", component: "app/account/page" },
        { url: "/photo/[id]", type: "shell", component: "app/photo/[id]/page" },
        { url: "/broken", type: "error", component: "app/broken/page" },
        { url: "/not-found", type: "frozen", component: "app/not-found" },
      ],
      routes,
      "https://example.com",
      built,
    );

    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).not.toContain("/account");
    expect(xml).not.toContain("[id]");
    expect(xml).not.toContain("/broken");
    expect(xml).not.toContain("not-found");
  });

  test("a dynamic page is listed, with no freshness to claim", () => {
    const xml = automaticSitemap(
      [{ url: "/feed", type: "dynamic", component: "app/feed/page" }],
      [{ component: "app/feed/page", middleware: [] }],
      "https://example.com",
      built,
    );

    expect(xml).toContain("<url><loc>https://example.com/feed</loc></url>");
  });
});
