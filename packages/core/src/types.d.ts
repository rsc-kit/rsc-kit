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

interface Metadata {
  title?: string;
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
  [key: string]: string | string[] | Icons | IconURL | (IconURL | IconDescriptor)[] | null | undefined;
}

type GenerateMetadata<P = Record<string, string>> = (params: P) => Metadata | Promise<Metadata>;
