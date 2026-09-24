import type { ReactNode } from 'react'
import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import { cookies } from '@rsc-kit/core/request'

// The shop's layout, under the root one - the demo's shape, and the one that
// matters: the boundary between them is seeded under the url the document
// loaded at, and stays active through every shop navigation. The cart count
// reads the request inside a boundary, so every shop page keeps a stored
// shell and the count arrives in the hole.
async function CartCount() {
  const count = Number((await cookies()).get('cart')?.value ?? 0)

  return <span id="cart-count">{count}</span>
}

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header>
        <Link href="/" id="brand">
          Store
        </Link>{' '}
        <Link href="/about">About</Link> cart{' '}
        <Suspense fallback={<span id="cart-count">…</span>}>
          <CartCount />
        </Suspense>
      </header>
      <main id="shop">{children}</main>
    </>
  )
}
