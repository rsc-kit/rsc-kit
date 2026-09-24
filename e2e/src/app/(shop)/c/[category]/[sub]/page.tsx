import { Suspense } from 'react'
import Link from '@rsc-kit/core/Link'
import { PRODUCTS, headingFor } from '../../../../../data'

async function Products({ params }: { params: Promise<{ category: string; sub: string }> }) {
  const { category, sub } = await params

  return (
    <>
      <h1>{headingFor(`/c/${category}/${sub}`)}</h1>
      <ul>
        {PRODUCTS.map((product) => (
          <li key={product}>
            <Link href={`/c/${category}/${sub}/${product}`}>{product}</Link>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function SubPage({ params }: { params: Promise<{ category: string; sub: string }> }) {
  return (
    <Suspense fallback={<p className="loading">loading</p>}>
      <Products params={params} />
    </Suspense>
  )
}
