'use server'

import { cookies } from '@rsc-kit/core/request'
import { revalidate } from '@rsc-kit/core/revalidate'

// The demo's add to cart: a cookie, and the whole document rendered again.
export async function addToCart(_: string | null, form: FormData): Promise<string> {
  const jar = await cookies()
  const count = Number(jar.get('cart')?.value ?? 0) + 1

  jar.set('cart', String(count), { path: '/' })
  revalidate('all')

  return `Added ${String(form.get('product'))}`
}
