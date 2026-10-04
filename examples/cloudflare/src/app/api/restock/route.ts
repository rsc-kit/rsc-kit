import { changed } from '@rsc-kit/core/changed'
import { restock } from '../../../versions'

/** The supplier's webhook: more stock arrived, and every tab showing it refreshes. */
export async function POST(): Promise<Response> {
  await restock(5)
  await changed('stock')

  return new Response(null, { status: 204 })
}
