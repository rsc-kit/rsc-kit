import { changed } from '@rsc-kit/core/changed'
import { restock } from '../../../webhook/store'

/**
 * The supplier's webhook: stock arrived. It changes the data and says which
 * name that was, and every open tab showing the stock section refreshes.
 *
 * With a backend the call is its own - rsckit.Changed in Go, Rsc::changed in
 * Laravel - and the versions live where it keeps shared state. This app has
 * no backend, so they live here, which is one instance.
 */
export async function POST(): Promise<Response> {
  restock(5)
  await changed('stock')

  return new Response(null, { status: 204 })
}
