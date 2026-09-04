import { Counter } from '../../Counter'

// A php-free server component — lets us exercise the worker+vite+socket path
// without the callback channel (which is proven separately).
export const metadata = { title: 'Static Page' }

export default function StaticPage() {
  return (
    <main>
      <h1>Static hello from vite engine</h1>
      <Counter />
    </main>
  )
}
