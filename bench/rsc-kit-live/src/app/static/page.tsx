import { PRODUCTS } from '../../data'

export default function StaticPage() {
  return (
    <main>
      <h1>Products</h1>
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
