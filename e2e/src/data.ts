// A catalogue small enough to reason about and big enough to walk: every url
// has one title, so a journey can check the heading on screen against the url
// in the bar - the check that caught a page not changing when its url did.

export const CATEGORIES = ['brushes', 'paper', 'inks', 'canvas', 'pencils', 'clay']
export const SUBS = ['basic', 'studio', 'travel']
export const PRODUCTS = ['one', 'two', 'three', 'four']

const title = (slug: string) => slug[0]!.toUpperCase() + slug.slice(1)

/** The heading a url shows. The journeys import this too. */
export function headingFor(path: string): string {
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 0) return 'Home'
  if (parts[0] === 'about') return 'About'

  const [, category, sub, product] = parts

  if (product) return `Product ${title(product)} of ${title(sub!)} ${title(category!)}`
  if (sub) return `${title(sub)} ${title(category!)}`

  return `Category ${title(category!)}`
}
