// iOS launch screens, from files named by their size.
//
//   src/app/
//     apple-splash-1179x2556.png   an iPhone 15, portrait
//     apple-splash-2556x1179.png   the same phone, landscape
//
// Safari ignores the manifest for a home-screen app's launch screen. It wants
// one image per device and orientation, each behind a media query naming the
// device's size and pixel ratio - and without a match it shows a blank
// screen. Writing those queries by hand is where this goes wrong: a pixel
// ratio off by one matches no device, silently.
//
// So the image carries its size in its name, the same bargain as
// `icon-192.png`, and the query comes from a table. Nothing opens the file:
// no decoding, no resizing, nothing at build, dev or runtime. The images are
// yours - make them however you like, at the sizes of the devices you care
// about. A size no device has is named by the build rather than dropped.

/** A device's screen: its size in css pixels, portrait, and its pixel ratio. */
interface Screen {
  width: number
  height: number
  ratio: number
}

/**
 * Portrait pixel size → screen. Current iPhones and iPads; one entry per
 * distinct screen, however many models share it.
 */
const SCREENS: Record<string, Screen> = {
  // iPhone
  '1320x2868': { width: 440, height: 956, ratio: 3 }, // 16 Pro Max
  '1206x2622': { width: 402, height: 874, ratio: 3 }, // 16 Pro
  '1290x2796': { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus / Pro Max, 16 Plus
  '1179x2556': { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  '1284x2778': { width: 428, height: 926, ratio: 3 }, // 12 / 13 Pro Max, 14 Plus
  '1170x2532': { width: 390, height: 844, ratio: 3 }, // 12, 12 Pro, 13, 13 Pro, 14
  '1242x2688': { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max
  '1125x2436': { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  '828x1792': { width: 414, height: 896, ratio: 2 }, // XR, 11
  '1242x2208': { width: 414, height: 736, ratio: 3 }, // 6 / 7 / 8 Plus
  '750x1334': { width: 375, height: 667, ratio: 2 }, // 6 / 7 / 8, SE 2nd and 3rd
  '640x1136': { width: 320, height: 568, ratio: 2 }, // SE 1st
  // iPad
  '2064x2752': { width: 1032, height: 1376, ratio: 2 }, // Pro 13" (M4)
  '2048x2732': { width: 1024, height: 1366, ratio: 2 }, // Pro 12.9"
  '1668x2420': { width: 834, height: 1210, ratio: 2 }, // Pro 11" (M4)
  '1668x2388': { width: 834, height: 1194, ratio: 2 }, // Pro 11"
  '1640x2360': { width: 820, height: 1180, ratio: 2 }, // Air 10.9", 10th generation
  '1668x2224': { width: 834, height: 1112, ratio: 2 }, // Pro 10.5", Air 3rd
  '1620x2160': { width: 810, height: 1080, ratio: 2 }, // 10.2"
  '1488x2266': { width: 744, height: 1133, ratio: 2 }, // mini 6th
  '1536x2048': { width: 768, height: 1024, ratio: 2 }, // mini, Air, 9.7"
}

const NAME = /^apple-splash-(\d{3,4})x(\d{3,4})\.(png|jpe?g)$/i

/** Whether a file in app/ is meant as a launch screen. */
export function isAppleSplash(file: string): boolean {
  return NAME.test(file)
}

/**
 * The media query a launch screen is shown behind, or null for a size no
 * device in the table has. Landscape is the same device with the size turned
 * round: iOS reports device-width and device-height in portrait either way.
 */
export function splashMedia(file: string): string | null {
  const match = NAME.exec(file)

  if (!match) return null

  const w = Number(match[1])
  const h = Number(match[2])
  const landscape = w > h
  const screen = SCREENS[landscape ? `${h}x${w}` : `${w}x${h}`]

  if (!screen) return null

  return (
    `screen and (device-width: ${screen.width}px) and (device-height: ${screen.height}px)` +
    ` and (-webkit-device-pixel-ratio: ${screen.ratio}) and (orientation: ${landscape ? 'landscape' : 'portrait'})`
  )
}

/** The launch screens whose size matches no device, for the build to name. */
export function unknownSplashes(files: string[]): string[] {
  return files.filter((file) => isAppleSplash(file) && splashMedia(file) === null)
}
