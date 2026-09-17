import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { PRODUCTS } from '../../data'

async function Greeting() {
  const user = (await cookies()).get('user')?.value ?? 'stranger'
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
