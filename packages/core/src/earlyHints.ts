// The Link header a document answers with, for a CDN to send ahead as 103
// Early Hints - so the stylesheet, the client entry and the fonts are on
// their way while the HTML is still being written. Cloudflare turns the
// header into hints and caches them at the edge for the next visitor;
// anything else passes it through, where a browser still reads it as the
// document arrives.
//
// The critical set and nothing more: a hint promotes whatever it names, and
// naming every chunk demotes the document behind them. The stylesheet and
// the client entry come from the build's own manifest, the same names the
// document carries. The fonts are the app's - preloaded in its layout - and
// are read from a stored document's own head; a rendered document's head is
// not known until it is rendered, after its headers have gone.

export interface CriticalAssets {
  /** Stylesheets the document links: `<link rel="stylesheet">`. */
  styles: string[];
  /** The client entry: `<script type="module">`'s import. */
  modules: string[];
  /** Fonts the document preloads: `<link rel="preload" as="font">`. */
  fonts: string[];
}

/** One `Link` header value for the set. Empty string for an empty set. */
export function linkHeader(assets: CriticalAssets): string {
  const parts: string[] = []

  for (const href of assets.styles) parts.push(`<${href}>; rel=preload; as=style`)
  for (const href of assets.modules) parts.push(`<${href}>; rel=modulepreload`)
  for (const href of assets.fonts) parts.push(`<${href}>; rel=preload; as=font; crossorigin`)

  return parts.join(', ')
}

const HEAD_LIMIT = 16_384
const LINK = /<link\s[^>]*>/g
const ATTR = (name: string, tag: string): string | null => {
  const match = new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)

  return match ? match[1] : null
}

/**
 * What a stored document's head names: its stylesheets and preloaded fonts.
 * The first 16 KB, which is the head of any document this build writes.
 */
export function criticalAssetsOf(html: string): CriticalAssets {
  const head = html.slice(0, HEAD_LIMIT)
  const found: CriticalAssets = { styles: [], modules: [], fonts: [] }

  for (const tag of head.match(LINK) ?? []) {
    const rel = ATTR('rel', tag)?.toLowerCase()
    const href = ATTR('href', tag)

    if (!href || !href.startsWith('/')) continue

    if (rel === 'stylesheet') found.styles.push(href)
    else if (rel === 'preload' && ATTR('as', tag)?.toLowerCase() === 'font') found.fonts.push(href)
  }

  // The bootstrap script is the last thing in the body, after the shell; its
  // import names the entry. The tail, then, and the head for a short page.
  const entry = /import\(["'](\/[^"']+\.js)["']\)/.exec(html.slice(-4096)) ?? /import\(["'](\/[^"']+\.js)["']\)/.exec(head)

  if (entry) found.modules.push(entry[1])

  return found
}

/** One set over another: the document's own names first, the build's where the document has none. */
export function mergeAssets(primary: CriticalAssets, fallback: CriticalAssets | null): CriticalAssets {
  if (!fallback) return primary

  return {
    styles: primary.styles.length ? primary.styles : fallback.styles,
    modules: primary.modules.length ? primary.modules : fallback.modules,
    fonts: primary.fonts.length ? primary.fonts : fallback.fonts,
  }
}
