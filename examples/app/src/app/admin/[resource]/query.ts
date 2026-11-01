import * as z from 'zod'

/** What a resource's list reads from its url. A filter is any other key. */
export const listSearch = z
  .object({
    q: z.string().optional(),
    sort: z.string().optional(),
    dir: z.enum(['asc', 'desc']).default('asc'),
    page: z.coerce.number().int().min(1).default(1),
  })
  .catchall(z.string())
