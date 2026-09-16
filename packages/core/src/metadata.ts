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
  url: string | URL
  type?: string
  sizes?: string
  color?: string
  rel?: string
  media?: string
  fetchPriority?: 'high' | 'low' | 'auto'
}

export type IconURL = string | URL

export interface Icons {
  icon?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[]
  apple?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[]
  shortcut?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[]
  other?: IconDescriptor | IconDescriptor[]
}

/** A layout's title, wrapping the titles of the pages beneath it. */
export interface TitleTemplate {
  /** `%s` stands in for the page's own title. */
  template?: string
  /** Used by a page that exports no title of its own. */
  default?: string
}

/** One image a share card may show. A string is its url. */
export interface OpenGraphImage {
  url: string | URL
  width?: number
  height?: number
  alt?: string
  type?: string
}

/**
 * The card a link to this page unfurls into on Facebook, Slack, LinkedIn and
 * most of the rest. Rendered with `property=`, which is what those scrapers
 * read — a `name=` attribute is ignored by every one of them.
 */
export interface OpenGraph {
  title?: string
  description?: string
  /** Absolute, or relative to `metadataBase`. */
  url?: string | URL
  siteName?: string
  type?: 'website' | 'article' | 'profile' | 'book' | (string & {})
  locale?: string
  images?: string | URL | OpenGraphImage | (string | URL | OpenGraphImage)[]
}

/** The same card for X, which reads `name=` rather than `property=`. */
export interface Twitter {
  card?: 'summary' | 'summary_large_image' | 'app' | 'player'
  title?: string
  description?: string
  /** The site's account, `@handle`. */
  site?: string
  /** The author's account, `@handle`. */
  creator?: string
  images?: string | URL | OpenGraphImage | (string | URL | OpenGraphImage)[]
}

export interface Metadata {
  /** A string on a page; a template on a layout, applied to the pages below it. */
  title?: string | TitleTemplate
  description?: string
  keywords?: string | string[]
  author?: string
  robots?: string
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
  metadataBase?: string | URL
  icons?: IconURL | (IconURL | IconDescriptor)[] | Icons | null
  openGraph?: OpenGraph
  twitter?: Twitter
  /** @deprecated Use `openGraph.title`. Still rendered, correctly, as `property=`. */
  'og:title'?: string
  /** @deprecated Use `openGraph.description`. */
  'og:description'?: string
  /** @deprecated Use `openGraph.images`. */
  'og:image'?: string
  /** @deprecated Use `openGraph.url`. */
  'og:url'?: string
  /** @deprecated Use `openGraph.type`. */
  'og:type'?: string
  /** @deprecated Use `openGraph.siteName`. */
  'og:site_name'?: string
  /** @deprecated Use `twitter.card`. */
  'twitter:card'?: string
  /** @deprecated Use `twitter.title`. */
  'twitter:title'?: string
  /** @deprecated Use `twitter.description`. */
  'twitter:description'?: string
  /** @deprecated Use `twitter.images`. */
  'twitter:image'?: string
  /** @deprecated Use `twitter.site`. */
  'twitter:site'?: string

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
  other?: Record<string, string | string[] | null | undefined>
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
  params: Promise<P>
  searchParams: Promise<URLSearchParams>
}) => Metadata | Promise<Metadata>
