import { describe, expect, test } from "bun:test";

import {
  absoluteUrl,
  llmsText,
  metadataResponse,
  robotsText,
  ROOT_FILES,
  sitemapXml,
} from "../../src/metadataRoutes";

/**
 * robots.ts, sitemap.ts and llms.ts beside the root layout, written the way
 * Next writes them, formatted the way the crawler reads them.
 */
describe("robots.txt", () => {
  test("is the rules, then the sitemaps and host", () => {
    const text = robotsText(
      {
        rules: [
          { userAgent: "*", allow: "/", disallow: ["/api/", "/private"] },
          { userAgent: ["GPTBot", "CCBot"], disallow: "/", crawlDelay: 10 },
        ],
        sitemap: "/sitemap.xml",
        host: "https://example.com",
      },
      "https://example.com",
    );

    expect(text).toBe(
      [
        "User-Agent: *",
        "Allow: /",
        "Disallow: /api/",
        "Disallow: /private",
        "",
        "User-Agent: GPTBot",
        "User-Agent: CCBot",
        "Disallow: /",
        "Crawl-delay: 10",
        "",
        "Sitemap: https://example.com/sitemap.xml",
        "Host: https://example.com",
        "",
      ].join("\n"),
    );
  });

  test("a single rule with no agent is for everyone", () => {
    expect(robotsText({ rules: { disallow: "/" } }, null)).toBe(
      "User-Agent: *\nDisallow: /\n",
    );
  });
});

describe("sitemap.xml", () => {
  test("is one <url> per entry with what it declares, escaped", () => {
    const xml = sitemapXml(
      [
        {
          url: "/",
          lastModified: new Date("2026-01-02T03:04:05Z"),
          changeFrequency: "weekly",
          priority: 1,
        },
        { url: "/search?q=a&b", lastModified: "2026-02-03" },
      ],
      new URL("https://example.com"),
    );

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain(
      "<url><loc>https://example.com/</loc><lastmod>2026-01-02T03:04:05.000Z</lastmod><changefreq>weekly</changefreq><priority>1</priority></url>",
    );
    expect(xml).toContain(
      "<loc>https://example.com/search?q=a&amp;b</loc><lastmod>2026-02-03</lastmod>",
    );
  });

  test("declares the namespaces only for what it uses", () => {
    const plain = sitemapXml([{ url: "https://a.test/" }], null);
    const rich = sitemapXml(
      [
        {
          url: "https://a.test/",
          alternates: { languages: { fr: "https://a.test/fr" } },
          images: ["https://a.test/i.png"],
        },
      ],
      null,
    );

    expect(plain).not.toContain("xmlns:xhtml");
    expect(rich).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(rich).toContain(
      'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"',
    );
    expect(rich).toContain(
      '<xhtml:link rel="alternate" hreflang="fr" href="https://a.test/fr"/>',
    );
    expect(rich).toContain(
      "<image:image><image:loc>https://a.test/i.png</image:loc></image:image>",
    );
  });
});

describe("llms.txt", () => {
  test("is the title, the summary as a quote, details, then sections of links", () => {
    const text = llmsText(
      {
        title: "Acme",
        summary: "What Acme is.",
        details: ["First.", "Second."],
        sections: [
          {
            title: "Docs",
            links: [
              { title: "Start", url: "/docs", description: "Where to begin" },
              { title: "API", url: "https://x.test/api" },
            ],
          },
          { title: "Optional", links: [{ title: "Blog", url: "/blog" }] },
        ],
      },
      "https://acme.test",
    );

    expect(text).toBe(
      [
        "# Acme",
        "",
        "> What Acme is.",
        "",
        "First.",
        "",
        "Second.",
        "",
        "## Docs",
        "",
        "- [Start](https://acme.test/docs): Where to begin",
        "- [API](https://x.test/api)",
        "",
        "## Optional",
        "",
        "- [Blog](https://acme.test/blog)",
        "",
      ].join("\n"),
    );
  });
});

describe("a relative url", () => {
  test("is made absolute with the root layout's metadataBase", () => {
    expect(absoluteUrl("/pricing", "https://a.test", "sitemap.ts")).toBe(
      "https://a.test/pricing",
    );
    expect(absoluteUrl("https://b.test/x", null, "sitemap.ts")).toBe(
      "https://b.test/x",
    );
  });

  test("and without one is refused, naming the file and the fix", () => {
    expect(() => absoluteUrl("/pricing", null, "sitemap.ts")).toThrow(
      "sitemap.ts names a relative url",
    );
    expect(() => absoluteUrl("/pricing", undefined, "robots.ts")).toThrow(
      "metadataBase",
    );
  });
});

describe("the response", () => {
  test("carries the type the crawler expects, and a string is served as written", async () => {
    const xml = await metadataResponse(
      "sitemap",
      () => [{ url: "https://a.test/" }],
      null,
    );
    const raw = await metadataResponse(
      "robots",
      async () => "User-Agent: *\nDisallow:\n",
      null,
    );

    expect(xml.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(await xml.text()).toContain("<loc>https://a.test/</loc>");
    expect(raw.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await raw.text()).toBe("User-Agent: *\nDisallow:\n");
  });
});

describe("files served at the root as they are", () => {
  test("are the ones a site is asked for there, and nothing else in app/", () => {
    for (const name of [
      "robots.txt",
      "sitemap.xml",
      "sitemap-posts.xml",
      "llms.txt",
      "llms-full.txt",
      "humans.txt",
      "security.txt",
      "ads.txt",
    ]) {
      expect(ROOT_FILES.test(name)).toBe(true);
    }
    for (const name of [
      "page.tsx",
      "layout.tsx",
      "app.css",
      "icon.png",
      "notes.txt",
      "sitemap.json",
    ]) {
      expect(ROOT_FILES.test(name)).toBe(false);
    }
  });
});
