'use client'

import { useState } from 'react'

// "use client" is the boundary: this component and what it imports are the
// only things that reach the browser.
export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <button className="mt-6 rounded border px-3 py-1 hover:bg-slate-50" onClick={() => setCount(count + 1)}>
      Clicked {count} times
    </button>
  )
}
