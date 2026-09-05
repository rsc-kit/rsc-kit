// Ambient types for an RSC app. Copied into the project's source directory by
// the host's build, so a page can annotate its metadata without importing
// anything.
//
// The host global (rpc) is NOT declared here: its name is configurable, so the
// host generates that declaration with the name it actually installed. Two
// ambient declarations of the same function would conflict.

/**
 * Page metadata for RSC pages.
 *
 * @example
 * ```tsx
 * export const metadata: Metadata = {
 *   title: 'My Page',
 *   description: 'Page description',
 *   keywords: ['react', 'laravel'],
 * };
 * ```
 */
interface IconDescriptor {
  url: string | URL;
  type?: string;
  sizes?: string;
  color?: string;
  rel?: string;
  media?: string;
  fetchPriority?: 'high' | 'low' | 'auto';
}

type IconURL = string | URL;

interface Icons {
  icon?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[];
  apple?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[];
  shortcut?: IconURL | IconDescriptor | (IconURL | IconDescriptor)[];
  other?: IconDescriptor | IconDescriptor[];
}

/** A layout's title, wrapping the titles of the pages beneath it. */
interface TitleTemplate {
  /** `%s` stands in for the page's own title. */
  template?: string;
  /** Used by a page that exports no title of its own. */
  default?: string;
}

interface Metadata {
  /** A string on a page; a template on a layout, applied to the pages below it. */
  title?: string | TitleTemplate;
  description?: string;
  keywords?: string | string[];
  author?: string;
  robots?: string;
  icons?: IconURL | (IconURL | IconDescriptor)[] | Icons | null;
  'og:title'?: string;
  'og:description'?: string;
  'og:image'?: string;
  'og:url'?: string;
  'og:type'?: string;
  'og:site_name'?: string;
  'twitter:card'?: string;
  'twitter:title'?: string;
  'twitter:description'?: string;
  'twitter:image'?: string;
  'twitter:site'?: string;
  [key: string]: string | string[] | TitleTemplate | Icons | IconURL | (IconURL | IconDescriptor)[] | null | undefined;
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
type GenerateMetadata<P = Record<string, string>> = (args: {
  params: Promise<P>;
  searchParams: Promise<URLSearchParams>;
}) => Metadata | Promise<Metadata>;
