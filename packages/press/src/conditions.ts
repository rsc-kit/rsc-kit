/**
 * What makes a field depend on another, as plain data: the browser applies it
 * while the visitor types, and the server applies it again to what was sent,
 * so the two cannot disagree. No functions - a field crosses to the browser.
 */

type Scalar = string | number | boolean

/**
 * When a field is shown: `{ when: 'type', is: 'business' }`, `is` one value
 * or several. `not` turns it round. With neither, the field shows once `when`
 * is filled in - or switched on.
 */
export interface Visibility {
  when: string
  is?: Scalar | Scalar[]
  not?: Scalar | Scalar[]
}

/**
 * A value made from another field's: `{ field: 'title' }` fills a slug while
 * the title is typed, until someone edits the slug by hand. Left empty, the
 * server fills it the same way.
 */
export interface Derivation {
  field: string
  /** What is made of it. A slug: lowercase letters, digits and dashes. */
  as?: 'slug'
}

/** A field's value as a condition reads it: a toggle is on or off, anything else its text. */
export type Read = (name: string) => string | boolean

export function shown(visible: Visibility, read: Read): boolean {
  const actual = read(visible.when)
  const text = typeof actual === 'boolean' ? String(actual) : actual
  const listed = (values: Scalar | Scalar[]) => ([] as Scalar[]).concat(values).map(String).includes(text)

  if (visible.is !== undefined) return listed(visible.is)
  if (visible.not !== undefined) return !listed(visible.not)

  return actual === true || (typeof actual === 'string' && actual !== '')
}

/** "Café & Bar - Downtown" is "cafe-bar-downtown". */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

