'use server'

import { Suspense } from 'react'
import { Counter } from './Counter'

// A server component the action renders. Async, so its row arrives after the
// root row: the action's answer streams, exactly as a page does.
async function Slow({ ms }: { ms: number }) {
  await new Promise((r) => setTimeout(r, ms))

  return <p id="slow">arrived after {ms}ms</p>
}

// Returns UI, not data. The engine serialises it with the same renderer a page
// uses, so a client component reference and a Suspense hole both survive the
// trip and the browser mounts the result as elements.
export async function renderCard(name: string) {
  return (
    <section id="card">
      <h2>{name}</h2>
      <Counter />
      <Suspense fallback={<p>loading…</p>}>
        <Slow ms={30} />
      </Suspense>
    </section>
  )
}

// The token-streaming shape from the guide: one chunk per row, a Suspense
// hole for the next. What createStreamableUI builds, with nothing installed.
async function* words() {
  for (const word of ['one', 'two', 'three']) {
    await new Promise((r) => setTimeout(r, 10))
    yield word
  }
}

async function Tokens({ from }: { from: AsyncIterator<string> }) {
  const { value, done } = await from.next()

  if (done) return null

  return (
    <>
      {value}
      <Suspense fallback={null}>
        <Tokens from={from} />
      </Suspense>
    </>
  )
}

export async function ask() {
  return (
    <Suspense fallback={<p>thinking…</p>}>
      <Tokens from={words()} />
    </Suspense>
  )
}
