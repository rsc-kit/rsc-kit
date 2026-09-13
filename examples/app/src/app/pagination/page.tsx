import { getPage } from '../../queries'
import { Providers } from '../providers'
import { Pages } from './pages'

export const metadata = { title: 'Pagination' }

/**
 * Page numbers, with the first page rendered into the document.
 *
 * Same query, same transport — the only difference from infinite loading is
 * that the argument is an offset rather than a cursor, and the pages replace
 * each other instead of accumulating.
 */
export default async function PaginationPage() {
  const first = await getPage(1)

  return (
    <main>
      <h1>Pagination</h1>
      <p>
        Page 1 came with the document. Moving between pages keeps the previous
        one on screen while the next is read, and going back to a page you have
        already seen costs nothing.
      </p>

      <Providers>
        <Pages initial={first} />
      </Providers>
    </main>
  )
}
