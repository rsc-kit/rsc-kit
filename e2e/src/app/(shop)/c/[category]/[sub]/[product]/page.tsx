import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import { PRODUCTS, headingFor } from '../../../../../../data'
import { AddToCart } from '../../../../../../components/AddToCart'
import { Label as First } from '../../../../../../components/one/Label'
import { Label as Second } from '../../../../../../components/two/Label'

async function Detail({ params }: { params: Promise<{ category: string; sub: string; product: string }> }) {
  const { category, sub, product } = await params

  return (
    <>
      <h1>{headingFor(`/c/${category}/${sub}/${product}`)}</h1>
      <p id="detail">Detail for {product}</p>
      <AddToCart product={product} />
      <ul>
        {PRODUCTS.filter((p) => p !== product).map((p) => (
          <li key={p}>
            <Link href={`/c/${category}/${sub}/${p}`}>{p}</Link>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function ProductPage({ params }: { params: Promise<{ category: string; sub: string; product: string }> }) {
  return (
    <>
      {/* Two different client components of one name, above the hole: a
          second bundler merging their scopes renames one, and a replay
          matches slots by name. A compiled binary must still resume. */}
      <First>first</First>
      <Second>second</Second>
      {/* Uncontrolled, for back and forward: what was typed must survive. */}
      <input id="note" name="note" aria-label="note" />
      <Suspense fallback={<p className="loading">loading</p>}>
        <Detail params={params} />
      </Suspense>
    </>
  )
}
