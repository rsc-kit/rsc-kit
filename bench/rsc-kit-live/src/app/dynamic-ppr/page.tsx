import { Suspense } from 'react'
import { cookies } from '@rsc-kit/core/request'
import { PRODUCTS } from '../../data'

// The page written the way the framework wants: the list is the same for
// everyone and lives in the stored shell; only the greeting reads the
// request, so only the greeting is rendered per visitor.
async function Greeting() {
  const user = (await cookies()).get('user') ?? 'stranger'
  return <p>Hello, {user}</p>
}

export default function DynamicPprPage() {
  return (
    <main>
      <h1>Products</h1>
      <Suspense fallback={<p>Hello…</p>}>
        <Greeting />
      </Suspense>
      <ul>
        {PRODUCTS.map((p) => (
          <li key={p.id}>
            {p.name} — ${p.price} — {p.stock} in stock
          </li>
        ))}
      </ul>
    </main>
  )
}
