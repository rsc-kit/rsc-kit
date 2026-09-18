// robots.txt, sitemap.xml and llms.txt, from a file beside the root layout.
//
// Each convention file becomes an api route the build synthesises - so a
// sitemap that reads nothing per request is stored at build like any frozen
// route, one that reads the request stays dynamic, and the build's table says
// which. What lives here is the formatting: the value the app's function
// returns, written the way the crawler expects it.

import type { MetadataRoute, RobotsRule, SitemapEntry } from "./metadata.js";

export const METADATA_ROUTES = {
  robots: { file: "robots.txt", type: "text/plain; charset=utf-8" },
  sitemap: { file: "sitemap.xml", type: "application/xml; charset=utf-8" },
  llms: { file: "llms.txt", type: "text/plain; charset=utf-8" },
  "llms-full": { file: "llms-full.txt", type: "text/plain; charset=utf-8" },
} as const;

export type MetadataRouteKind = keyof typeof METADATA_ROUTES;

/**
 * Files an app may drop beside the root layout to be served at the root as
 * they are: the same three, hand-written, and the handful of other files a
 * site is asked for at its root.
 */
export const ROOT_FILES =
  /^(?:robots\.txt|sitemap(?:-[\w.-]+)?\.xml|llms(?:-full)?\.txt|humans\.txt|security\.txt|ads\.txt|app-ads\.txt)$/;

export function rootFileType(name: string): string {
  return name.endsWith(".xml")
    ? "application/xml; charset=utf-8"
    : "text/plain; charset=utf-8";
}

function list<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/**
 * A url made absolute. A relative one needs the root layout's metadataBase -
 * a crawler is handed these with no page to resolve them against.
 */
export function absoluteUrl(
  url: string,
  base: string | URL | null | undefined,
  file: string,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;

  if (!base) {
    throw new Error(
      `[rsc-kit] ${file} names a relative url, ${JSON.stringify(url)}, and the root layout has no metadataBase to make it absolute. ` +
        "Add metadataBase: new URL('https://example.com') to the root layout's metadata, or write the url in full.",
    );
  }

  return new URL(url, base).href;
}

export function robotsText(
  robots: MetadataRoute.Robots,
  base: string | URL | null | undefined,
): string {
  const blocks = list(robots.rules).map((rule: RobotsRule) => {
    const lines: string[] = [];

    for (const agent of list(rule.userAgent).length
      ? list(rule.userAgent)
      : ["*"])
      lines.push(`User-Agent: ${agent}`);
    for (const path of list(rule.allow)) lines.push(`Allow: ${path}`);
    for (const path of list(rule.disallow)) lines.push(`Disallow: ${path}`);
    if (rule.crawlDelay !== undefined)
      lines.push(`Crawl-delay: ${rule.crawlDelay}`);

    return lines.join("\n");
  });

  const tail: string[] = [];

  for (const sitemap of list(robots.sitemap))
    tail.push(`Sitemap: ${absoluteUrl(sitemap, base, "robots.ts")}`);
  if (robots.host) tail.push(`Host: ${robots.host}`);

  return (
    [...blocks, ...(tail.length ? [tail.join("\n")] : [])].join("\n\n") + "\n"
  );
}

function escapeXml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
}

export function sitemapXml(
  entries: MetadataRoute.Sitemap,
  base: string | URL | null | undefined,
): string {
  const hasAlternates = entries.some(
    (e) =>
      e.alternates?.languages && Object.keys(e.alternates.languages).length > 0,
  );
  const hasImages = entries.some((e) => e.images && e.images.length > 0);

  const urls = entries.map((entry: SitemapEntry) => {
    const parts = [
      `<loc>${escapeXml(absoluteUrl(entry.url, base, "sitemap.ts"))}</loc>`,
    ];

    if (entry.lastModified !== undefined) {
      const when =
        entry.lastModified instanceof Date
          ? entry.lastModified.toISOString()
          : entry.lastModified;

      parts.push(`<lastmod>${escapeXml(when)}</lastmod>`);
    }
    if (entry.changeFrequency)
      parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
    if (entry.priority !== undefined)
      parts.push(`<priority>${entry.priority}</priority>`);
    for (const [lang, href] of Object.entries(
      entry.alternates?.languages ?? {},
    )) {
      parts.push(
        `<xhtml:link rel="alternate" hreflang="${escapeXml(lang)}" href="${escapeXml(absoluteUrl(href, base, "sitemap.ts"))}"/>`,
      );
    }
    for (const image of entry.images ?? []) {
      parts.push(
        `<image:image><image:loc>${escapeXml(absoluteUrl(image, base, "sitemap.ts"))}</image:loc></image:image>`,
      );
    }

    return `<url>${parts.join("")}</url>`;
  });

  const namespaces = [
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    ...(hasAlternates ? ['xmlns:xhtml="http://www.w3.org/1999/xhtml"'] : []),
    ...(hasImages
      ? ['xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"']
      : []),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces.join(" ")}>\n${urls.join("\n")}\n</urlset>\n`;
}

export function llmsText(
  llms: MetadataRoute.Llms,
  base: string | URL | null | undefined,
): string {
  const out: string[] = [`# ${llms.title}`];

  if (llms.summary) out.push("", `> ${llms.summary}`);
  for (const paragraph of list(llms.details)) out.push("", paragraph);

  for (const section of llms.sections ?? []) {
    out.push("", `## ${section.title}`, "");
    for (const link of section.links) {
      out.push(
        `- [${link.title}](${absoluteUrl(link.url, base, "llms.ts")})${link.description ? `: ${link.description}` : ""}`,
      );
    }
  }

  return out.join("\n") + "\n";
}

/**
 * The response for one of these routes: what the app's function returned,
 * formatted, unless it returned the text itself. Called by the route the
 * build synthesised, never by an app directly.
 */
export async function metadataResponse(
  kind: MetadataRouteKind,
  produce: () => unknown,
  base: string | URL | null | undefined,
): Promise<Response> {
  const value = await produce();
  const body =
    typeof value === "string"
      ? value
      : kind === "robots"
        ? robotsText(value as MetadataRoute.Robots, base)
        : kind === "sitemap"
          ? sitemapXml(value as MetadataRoute.Sitemap, base)
          : llmsText(value as MetadataRoute.Llms, base);

  return new Response(body, {
    headers: { "Content-Type": METADATA_ROUTES[kind].type },
  });
}
