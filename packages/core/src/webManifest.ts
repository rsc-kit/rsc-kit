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

/** A jump into the app from its icon - a long press on Android, a right click on desktop. */
export interface ManifestShortcut {
  name: string
  shortName?: string
  description?: string
  url: string
  /** Paths, like `icons`: sizes read from the filename. */
  icons?: string[]
}

/** What `rscKit({ manifest })` takes. */
export interface WebManifestOptions {
  /**
   * The app's identity. Without it a browser derives one from `startUrl`, and
   * changing that later leaves everyone who installed with an orphaned app -
   * a different app, as far as their device is concerned. `'/'` is right for
   * almost everyone, set once and never changed.
   */
  id?: string
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
  /** The urls that are the app; a link outside it opens in the browser. Defaults to the start url's directory. */
  scope?: string
  /** Lock the installed app to a way of holding the device. */
  orientation?: 'any' | 'natural' | 'portrait' | 'landscape' | 'portrait-primary' | 'landscape-primary'
  /** What a store or an install sheet files it under: `['productivity']`. */
  categories?: string[]
  /** Jumps from the app's icon. */
  shortcuts?: ManifestShortcut[]
  /**
   * What Chrome's richer install sheet shows. Rarely written here: an
   * `app/screenshot-wide-1280x720.png` or `screenshot-narrow-…` is found by
   * name, its size and form factor read from it - see the PWA guide.
   */
  screenshots?: string[]
  /** Defaults to `standalone`, which is the one that looks like an app. */
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser'
  /** The colour a browser paints its chrome. Also emitted as a meta tag. */
  themeColor?: string
  /** The colour behind the app while it is starting. */
  backgroundColor?: string
  /** Anything else the spec allows, passed through untouched. */
  other?: Record<string, unknown>
}

/** An icon drawn for a launcher's mask: `icon-maskable-512.png`. */
export function isMaskable(file: string): boolean {
  return /(^|[/-])maskable\b/i.test(file)
}

/** A screenshot's size, from `screenshot-wide-1280x720.png`; null when the name carries none. */
export function screenshotSize(file: string): { width: number; height: number } | null {
  const match = /(\d{3,4})x(\d{3,4})\.(?:png|webp|jpe?g)$/i.exec(file)

  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
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

/** One icon, as the manifest spec writes it. */
function iconEntry(file: string) {
  const size = sizeOf(file)

  return {
    src: file.startsWith('/') ? file : `/${file}`,
    type: typeOf(file),
    ...(size ? { sizes: `${size}x${size}` } : {}),
    // One purpose per icon, from the name. A maskable icon is drawn with a
    // safe zone - the middle 80% is all a launcher promises to show - so
    // used as "any" it looks shrunk, and an ordinary icon used as
    // "maskable" has its corners cut off. "any maskable" on one file was
    // both at once, and the Android splash drew the shrunk one.
    purpose: isMaskable(file) ? 'maskable' : 'any',
  }
}

/** The manifest's JSON, ready to write. */
export function webManifest(options: WebManifestOptions): string {
  const icons = (options.icons ?? []).map(iconEntry)

  const shortcuts = (options.shortcuts ?? []).map((shortcut) => ({
    name: shortcut.name,
    ...(shortcut.shortName ? { short_name: shortcut.shortName } : {}),
    ...(shortcut.description ? { description: shortcut.description } : {}),
    url: shortcut.url,
    ...(shortcut.icons?.length ? { icons: shortcut.icons.map(iconEntry) } : {}),
  }))

  const screenshots = (options.screenshots ?? []).map((file) => {
    const size = screenshotSize(file)

    return {
      src: file.startsWith('/') ? file : `/${file}`,
      type: typeOf(file),
      ...(size ? { sizes: `${size.width}x${size.height}`, form_factor: size.width > size.height ? 'wide' : 'narrow' } : {}),
    }
  })

  return (
    JSON.stringify(
      {
        ...(options.id ? { id: options.id } : {}),
        name: options.name,
        short_name: options.shortName ?? options.name,
        ...(options.description ? { description: options.description } : {}),
        start_url: options.startUrl ?? '/',
        ...(options.scope ? { scope: options.scope } : {}),
        display: options.display ?? 'standalone',
        ...(options.orientation ? { orientation: options.orientation } : {}),
        ...(options.categories?.length ? { categories: options.categories } : {}),
        ...(options.themeColor ? { theme_color: options.themeColor } : {}),
        ...(options.backgroundColor ? { background_color: options.backgroundColor } : {}),
        ...(icons.length ? { icons } : {}),
        ...(shortcuts.length ? { shortcuts } : {}),
        ...(screenshots.length ? { screenshots } : {}),
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

  // Android builds its splash from the name, the largest icon and this
  // colour. Without it the splash is white, whatever the app looks like.
  if (!options.backgroundColor) {
    return 'manifest: no backgroundColor, so the Android splash screen is white. Set it to the colour the app starts on.'
  }

  // The one that bites later rather than now: an install keyed on startUrl
  // is a different app the day startUrl changes.
  if (!options.id) {
    return "manifest: no id, so the app's identity is its startUrl - change that and everyone who installed has a different app. Set id: '/'."
  }

  return null
}

/** The type a src/app/manifest.ts file satisfies. */
export type WebManifest = WebManifestOptions
