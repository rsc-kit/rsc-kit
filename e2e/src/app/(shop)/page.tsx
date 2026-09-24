import Link from '@rsc-kit/core/Link'
import { CATEGORIES } from '../../data'

export default function Home() {
  return (
    <>
      <h1>Home</h1>
      <ul>
        {CATEGORIES.map((category) => (
          <li key={category}>
            <Link href={`/c/${category}`}>{category}</Link>
          </li>
        ))}
      </ul>
    </>
  )
}
