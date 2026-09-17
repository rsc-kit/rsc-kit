import { cookies } from 'next/headers'
import { PRODUCTS } from '../../data'

export default async function DynamicPage() {
  const user = (await cookies()).get('user')?.value ?? 'stranger'

  return (
    <main>
      <h1>Products</h1>
      <p>Hello, {user}</p>
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
