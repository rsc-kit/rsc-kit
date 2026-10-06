import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import { cookies } from '@rsc-kit/core/request'
import { notFound } from '@rsc-kit/core/not-found'
import { signInAndReturn } from '../../../../../../actions'
import { PRODUCTS, headingFor } from '../../../../../../data'
import { AddToCart } from '../../../../../../components/AddToCart'
import { Label as First } from '../../../../../../components/one/Label'
import { Label as Second } from '../../../../../../components/two/Label'

async function Detail({ params }: { params: Promise<{ category: string; sub: string; product: string }> }) {
  const { category, sub, product } = await params

  // Inside the boundary, as a page reading its record does: decided after
  // the shell's 200 has gone out.
  if (!PRODUCTS.includes(product)) notFound()

  return (
    <>
      <h1>{headingFor(`/c/${category}/${sub}/${product}`)}</h1>
      <p id="detail">Detail for {product}</p>
      <AddToCart product={product} />
      <p id="signed-in">signed in: {(await cookies()).get('signed-in')?.value ?? 'no'}</p>
      <form action={signInAndReturn}>
        <input type="hidden" name="to" value={`/c/${category}/${sub}/one`} />
        <button type="submit" id="sign-in">sign in and return</button>
      </form>
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

// A lookup, as a product page's is: it must never hold up the first byte.
export async function generateMetadata({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params

  await new Promise((resolve) => setTimeout(resolve, 300))

  return { title: `Product ${product}` }
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
