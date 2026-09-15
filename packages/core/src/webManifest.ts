// The file that makes an app installable.
//
// A service worker makes an app work offline; this is what makes a browser
// offer to put it on a home screen. They are separate decisions and separate
// options, because an app can want either without the other — a site that
// should survive a dead network is not necessarily one anybody wants as an
// icon, and vice versa.
//
// Everything here is the web app manifest spec rather than an invention of
// this package, so the names are its names and anything it accepts that is not
// spelled out below can be passed through `other`.

/** What `rscKit({ manifest })` takes. */
export interface WebManifestOptions {
  /** The app's name, as an install prompt shows it. */
  name: string
  /** The short name a home screen uses when there is no room for the full one. */
  shortName?: string
  description?: string
  /**
   * The icons a browser may install.
   *
   * Paths relative to the client output — a file in `public/` is served at its
   * own name, so `icon-192.png` is usually right. Sizes and types are read from
   * the filename rather than declared twice.
   *
   * A browser will not offer to install an app with no icon of at least 192px,
   * so the build says so rather than writing a manifest that quietly does
   * nothing.
   */
  icons?: string[]
  /** Where an installed launch lands. Defaults to `/`. */
  startUrl?: string
  /** Defaults to `standalone`, which is the one that looks like an app. */
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
  /** The colour a browser paints its chrome. Also emitted as a meta tag. */
  themeColor?: string
  /** The colour behind the app while it is starting. */
  backgroundColor?: string
  /** Anything else the spec allows, passed through untouched. */
  other?: Record<string, unknown>
}

/** Where the manifest is written and linked from. */
export const MANIFEST_PATH = '/manifest.webmanifest'

/**
 * The size a filename claims, or null.
 *
 * `icon-192.png` and `icon-192x192.png` both read as 192. Declaring it in the
 * options as well would be the same number written twice, and the one that
 * drifts is the one nobody looks at.
 */
export function sizeOf(file: string): number | null {
  const match = /(\d{2,4})(?:x\d{2,4})?\.(?:png|webp|jpg|jpeg|svg)$/i.exec(file)

  return match ? Number(match[1]) : null
}

function typeOf(file: string): string {
  const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase()

  return extension === 'svg'
    ? 'image/svg+xml'
    : extension === 'jpg' || extension === 'jpeg'
      ? 'image/jpeg'
      : `image/${extension}`
}

/** The manifest's JSON, ready to write. */
export function webManifest(options: WebManifestOptions): string {
  const icons = (options.icons ?? []).map((file) => {
    const size = sizeOf(file)

    return {
      src: file.startsWith('/') ? file : `/${file}`,
      type: typeOf(file),
      ...(size ? { sizes: `${size}x${size}` } : {}),
      // Maskable as well as any: without it Android crops a square icon into a
      // circle and takes the corners off whatever is in them.
      purpose: 'any maskable',
    }
  })

  return (
    JSON.stringify(
      {
        name: options.name,
        short_name: options.shortName ?? options.name,
        ...(options.description ? { description: options.description } : {}),
        start_url: options.startUrl ?? '/',
        display: options.display ?? 'standalone',
        ...(options.themeColor ? { theme_color: options.themeColor } : {}),
        ...(options.backgroundColor ? { background_color: options.backgroundColor } : {}),
        ...(icons.length ? { icons } : {}),
        ...(options.other ?? {}),
      },
      null,
      2,
    ) + '\n'
  )
}

/**
 * Whether these options produce something a browser would actually install.
 *
 * Returned as a sentence rather than thrown: a manifest with no icon is still
 * a valid manifest and still sets the theme colour, so refusing the build over
 * it would be refusing something that works. But an author who wrote
 * `manifest: {...}` meant "installable", and silence here is how they find out
 * months later that it never was.
 */
export function manifestWarning(options: WebManifestOptions): string | null {
  const icons = options.icons ?? []

  if (icons.length === 0) {
    return 'manifest: no icons, so no browser will offer to install this. Add a 192px and a 512px png.'
  }

  const largest = icons.reduce((best, file) => Math.max(best, sizeOf(file) ?? 0), 0)

  if (largest < 192) {
    return 'manifest: no icon of 192px or more, which is the smallest a browser will install. Sizes are read from the filename, so name it like icon-192.png.'
  }

  if (largest < 512) {
    return 'manifest: no 512px icon, so a splash screen will be upscaled from a smaller one.'
  }

  return null
}
