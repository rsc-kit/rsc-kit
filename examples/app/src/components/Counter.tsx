'use client'

import { useState } from 'react'
import { addToTotal } from '../actions'

// A client component. Its state survives navigating away and back, because the
// host answers navigations with a segment rather than a whole document — see
// the README.
export function Counter() {
  const [count, setCount] = useState(0)
  const [total, setTotal] = useState<number | null>(null)

  return (
    <div className="counter">
      <button onClick={() => setCount((c) => c + 1)}>Count: {count}</button>
      <button onClick={async () => setTotal(await addToTotal(count))}>
        {total === null ? 'Send to server' : `Server total: ${total}`}
      </button>
    </div>
  )
}
