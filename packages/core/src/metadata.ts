// What a page says about itself, as importable types.
//
//     import type { Metadata } from '@rsc-kit/core/metadata'
//
//     export const metadata: Metadata = { title: 'Orders' }
//
// Imported rather than ambient, and that is the whole point of the move. An
// ambient declaration has to be COPIED into the project, which means it is not
// there until the build has run once — so a freshly cloned app reports "Cannot
// find name 'Metadata'" on every page until someone runs the dev server. An
// import resolves from node_modules the moment dependencies are installed.
//
// The ambient names still work. `.rsc-kit/rsc-types.d.ts` now aliases these
// rather than restating them, so there is one definition and two ways to reach
// it.

export interface IconDescriptor {
  url: string | URL;
  type?: string;
  sizes?: string;
  color?: string;
  rel?: string;
  media?: string;
  fetchPriority?: "high" | "low" | "auto";
}

export type IconURL = string | URL;

export interface Icons {
  icon?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[];
  apple?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[];
  shortcut?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[];
  other?: IconDescriptor | IconDescriptor[];
}

/** A layout's title, wrapping the titles of the pages beneath it. */
export interface TitleTemplate {
  /** `%s` stands in for the page's own title. */
  template?: string;
  /** Used by a page that exports no title of its own. */
  default?: string;
}

/** One image a share card may show. A string is its url. */
export interface OpenGraphImage {
  url: string | URL;
  width?: number;
  height?: number;
  alt?: string;
  type?: string;
}

/**
 * The card a link to this page unfurls into on Facebook, Slack, LinkedIn and
 * most of the rest. Rendered with `property=`, which is what those scrapers
 * read — a `name=` attribute is ignored by every one of them.
 */
export interface OpenGraph {
  title?: string;
  description?: string;
  /** Absolute, or relative to `metadataBase`. */
  url?: string | URL;
  siteName?: string;
  type?: "website" | "article" | "profile" | "book" | (string & {});
  locale?: string;
  images?: string | URL | OpenGraphImage | (string | URL | OpenGraphImage)[];
}

/** The same card for X, which reads `name=` rather than `property=`. */
export interface Twitter {
  card?: "summary" | "summary_large_image" | "app" | "player";
  title?: string;
  description?: string;
  /** The site's account, `@handle`. */
  site?: string;
  /** The author's account, `@handle`. */
  creator?: string;
  images?: string | URL | OpenGraphImage | (string | URL | OpenGraphImage)[];
}

export interface Robots {
  index?: boolean;
  follow?: boolean;
  noarchive?: boolean;
  nosnippet?: boolean;
  noimageindex?: boolean;
  nocache?: boolean;
  notranslate?: boolean;
  indexifembedded?: boolean;
  nositelinkssearchbox?: boolean;
  unavailable_after?: string;
  "max-video-preview"?: number | string;
  "max-image-preview"?: "none" | "standard" | "large";
  "max-snippet"?: number;
  googleBot?: string | Omit<Robots, "googleBot">;
}

/** An iOS launch screen: an image, and the media query naming the device it is for. */
export interface AppleStartupImage {
  url: string | URL;
  media?: string;
}

export interface AppleWebApp {
  /** Opens as an app from the home screen - no browser chrome. */
  capable?: boolean;
  /** The name under the home screen icon, when it should differ from the page title. */
  title?: string;
  /** The status bar over the app: `default`, `black`, or `black-translucent` to draw under it. */
  statusBarStyle?: "default" | "black" | "black-translucent";
  /** Launch screens. A string or url is one image for every device. */
  startupImage?: string | URL | (string | URL | AppleStartupImage)[];
}

export interface Metadata {
  /** A string on a page; a template on a layout, applied to the pages below it. */
  title?: string | TitleTemplate;
  description?: string;
  keywords?: string | string[];
  author?: string;
  /**
   * A string, or the object Next takes: `{ index: false, follow: false }`
   * becomes `<meta name="robots" content="noindex, nofollow">`, the flags
   * by name, the limits as `name:value`; `googleBot` is the same shape for
   * `<meta name="googlebot">`.
   */
  robots?: string | Robots;
  /**
   * Where the site lives, so a relative image or url can be made absolute.
   *
   *     metadataBase: new URL('https://example.com')
   *
   * On the root layout, once. A share-card scraper needs an absolute url and
   * several refuse a relative one; without this, `og:image` for an image in
   * `app/` is emitted relative and works in some places and not others. The
   * same name as Next, so a port carries it across unchanged.
   */
  metadataBase?: string | URL;
  icons?: IconURL | (IconURL | IconDescriptor)[] | Icons | null;
  openGraph?: OpenGraph;
  twitter?: Twitter;
  /**
   * How the app behaves added to an iPhone's home screen. Next's shape, so a
   * port carries it across unchanged.
   *
   *     appleWebApp: {
   *       capable: true,
   *       title: 'Orders',
   *       statusBarStyle: 'black-translucent',
   *       startupImage: [{ url: '/splash-1179x2556.png', media: '...' }],
   *     }
   *
   * `true` is `{ capable: true }`. Launch screens are simpler as files: an
   * `apple-splash-1179x2556.png` in `app/` is linked with the right media
   * query for the device its size names - see the PWA guide.
   */
  appleWebApp?: boolean | AppleWebApp;
  /** @deprecated Use `openGraph.title`. Still rendered, correctly, as `property=`. */
  "og:title"?: string;
  /** @deprecated Use `openGraph.description`. */
  "og:description"?: string;
  /** @deprecated Use `openGraph.images`. */
  "og:image"?: string;
  /** @deprecated Use `openGraph.url`. */
  "og:url"?: string;
  /** @deprecated Use `openGraph.type`. */
  "og:type"?: string;
  /** @deprecated Use `openGraph.siteName`. */
  "og:site_name"?: string;
  /** @deprecated Use `twitter.card`. */
  "twitter:card"?: string;
  /** @deprecated Use `twitter.title`. */
  "twitter:title"?: string;
  /** @deprecated Use `twitter.description`. */
  "twitter:description"?: string;
  /** @deprecated Use `twitter.images`. */
  "twitter:image"?: string;
  /** @deprecated Use `twitter.site`. */
  "twitter:site"?: string;

  /**
   * Any other meta tag, by name.
   *
   *     other: { 'fb:app_id': '123', 'theme-color': '#000' }
   *
   * Here rather than alongside the named keys, and that is what makes the rest
   * of this interface worth annotating. An index signature on the interface
   * itself made every key legal — so `titel` was accepted in silence, and an
   * editor offered no completions at all, because with any identifier valid
   * TypeScript reads an unfinished key as a shorthand property and goes looking
   * for a variable by that name.
   */
  other?: Record<string, string | string[] | null | undefined>;
}

/**
 * Metadata that depends on the request.
 *
 * Receives the same awaitables a page does, so one shape is learned rather
 * than two:
 *
 *     export const generateMetadata: GenerateMetadata<{ slug: string }> =
 *       async ({ params }) => ({ title: (await params).slug })
 */
export type GenerateMetadata<P = Record<string, string>> = (args: {
  params: Promise<P>;
  searchParams: Promise<URLSearchParams>;
}) => Metadata | Promise<Metadata>;

/** One rule block of a robots.txt: which agents, what they may and may not fetch. */
export interface RobotsRule {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
  crawlDelay?: number;
}

/** One url of a sitemap. `url` may be relative when the root layout has a metadataBase. */
export interface SitemapEntry {
  url: string;
  lastModified?: string | Date;
  changeFrequency?:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
  /** Image urls on this page, for image search. */
  images?: string[];
  /** Translations of this page: language tag to url. */
  alternates?: { languages?: Record<string, string> };
}

/** A link in an llms.txt section. */
export interface LlmsLink {
  title: string;
  url: string;
  description?: string;
}

export interface LlmsSection {
  title: string;
  links: LlmsLink[];
}

/**
 * The files a site describes itself with, each from a file beside the root
 * layout and written the way Next writes them:
 *
 *     app/robots.ts   -> /robots.txt     default export returns MetadataRoute.Robots
 *     app/sitemap.ts  -> /sitemap.xml    default export returns MetadataRoute.Sitemap
 *     app/llms.ts     -> /llms.txt       default export returns MetadataRoute.Llms
 *
 * Each may return a string instead, served as written. A relative url in any
 * of them is made absolute with the root layout's metadataBase.
 */
export namespace MetadataRoute {
  export type Robots = {
    rules: RobotsRule | RobotsRule[];
    sitemap?: string | string[];
    host?: string;
  };
  export type Sitemap = SitemapEntry[];
  /** The llms.txt shape at llmstxt.org: a title, a summary, then sections of links. */
  export type Llms = {
    title: string;
    summary?: string;
    /** Paragraphs after the summary, before the sections. */
    details?: string | string[];
    sections?: LlmsSection[];
  };
}

/**
 * `export const viewport`, in Next's shape, on a layout or a page: layouts
 * outer to inner, then the page, merged per key. What is not set is
 * `width=device-width, initial-scale=1`, written into every document the way
 * Next wrote it — a layout ported from Next never wrote the tag, and a page
 * without one is the desktop layout on a phone. A layout that renders
 * `<meta name="viewport">` itself is left alone.
 */
export interface Viewport {
  width?: string | number;
  height?: string | number;
  initialScale?: number;
  minimumScale?: number;
  maximumScale?: number;
  userScalable?: boolean;
  viewportFit?: "auto" | "cover" | "contain";
  interactiveWidget?: "resizes-visual" | "resizes-content" | "overlays-content";
  /** One colour, or one per media query. Wins over the web manifest's. */
  themeColor?: string | { media?: string; color: string }[];
  colorScheme?: "normal" | "light" | "dark" | "light dark" | "dark light" | "only light";
}
