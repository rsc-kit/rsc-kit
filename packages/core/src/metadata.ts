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

export interface Metadata {
  /** A string on a page; a template on a layout, applied to the pages below it. */
  title?: string | TitleTemplate
  description?: string
  keywords?: string | string[]
  author?: string
  robots?: string
  icons?: IconURL | (IconURL | IconDescriptor)[] | Icons | null
  'og:title'?: string
  'og:description'?: string
  'og:image'?: string
  'og:url'?: string
  'og:type'?: string
  'og:site_name'?: string
  'twitter:card'?: string
  'twitter:title'?: string
  'twitter:description'?: string
  'twitter:image'?: string
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
