import type { Tenant } from './resource.js'

/**
 * Where an upload is kept. One function: given the file, keep it somewhere
 * and answer what the record saves - usually the url it is served from. A
 * bucket (S3, R2, Bun.s3), a disk, a backend: press calls this and nothing
 * else, and ships none of them, as it ships no database.
 *
 * The file has been checked against the field's accept and maxSize, and the
 * rest of the form has passed its schema, so a refused save does not leave
 * a file behind. Its name and type are the browser's word: name what you
 * keep yourself, and serve it with a type you chose.
 */
export interface Storage {
  put(file: File, context: StorageContext): Promise<string>
}

export interface StorageContext {
  /** The field it was uploaded to: `cover`, or `content.2.image` inside a block. */
  field: string
  /** The tenant the visitor is working in; null outside a panel with tenants. */
  tenant: Tenant | null
}

/**
 * What an image field takes unless it says otherwise: the formats a browser
 * draws. Not SVG - an SVG is a document that can run script, and served from
 * the app's own origin it runs as the app. A field that wants one says
 * accept: 'image/svg+xml' and serves it from somewhere else.
 */
export const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

/** Whether a file is one the accept list names, as the attribute reads it: types, `type/*`, and `.extensions`. */
export function accepts(accept: string | undefined, file: File): boolean {
  if (!accept) return true

  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  return accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => (token.startsWith('.') ? name.endsWith(token) : token.endsWith('/*') ? type.startsWith(token.slice(0, -1)) : type === token))
}

/** 2097152 as "2 MB": what a person reads a size limit as. */
export function sizeOf(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${+(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`

  return `${bytes} bytes`
}
