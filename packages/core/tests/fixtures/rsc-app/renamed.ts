// A row an action renames, and a cache()d read of it: what the middleware
// and the action see before the write, and what the revalidation must not.
import { cache } from '../../../src/cache'

let name = 'before'

export const currentName = cache(async () => name)

export function setName(next: string): void {
  name = next
}
