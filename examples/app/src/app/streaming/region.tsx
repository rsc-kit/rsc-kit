'use client'

import { use, useEffect, useState } from 'react'

/**
 * Resolves a promise the server started.
 *
 * Nothing from this package is involved — `use()` is React's, and the promise
 * came through the payload like any other prop.
 */
export function Region({ listings }: { listings: Promise<string[]> }) {
  return (
    <ul>
      {use(listings).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/** How long the page has been open, so the arrivals can be read off a clock. */
export function Clock() {
  const [ms, setMs] = useState(0)

  useEffect(() => {
    const started = performance.now()
    const id = setInterval(() => setMs(Math.round(performance.now() - started)), 50)

    return () => clearInterval(id)
  }, [])

  return <p><strong>{ms}ms</strong> since hydration</p>
}
