import type { Resource } from './kit'
import { products } from './resources/products'

/** Every resource the panel shows, by the name its url uses. */
export const resources: Record<string, Resource> = { products }

export function resource(name: string): Resource | null {
  return resources[name] ?? null
}
