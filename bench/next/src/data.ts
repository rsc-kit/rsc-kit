// The same fifty rows for every framework. Deterministic, in memory: the
// bakeoff measures the framework, not a database.
export interface Product { id: number; name: string; price: string; stock: number }

export const PRODUCTS: Product[] = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  name: `Product ${i + 1}`,
  price: ((i * 7919) % 10000 / 100).toFixed(2),
  stock: (i * 31) % 97,
}))
