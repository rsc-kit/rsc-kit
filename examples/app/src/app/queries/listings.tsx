'use client'

import { use, useState } from 'react'
import { readQuery } from '@rsc-kit/core/queryClient'
import { getListingCount, getListings } from '../../queries'

/**
 * The RSC-native read: a promise the server started, resolved here.
 *
 * Nothing in this package is involved. `use()` is React's and the promise came
 * through the payload like any other prop — which is why this is the shape to
 * reach for first, and the only one that server-renders.
 */
export function Streamed({ listings }: { listings: Promise<string[]> }) {
  return (
    <ul>
      {use(listings).map((listing) => (
        <li key={listing}>{listing}</li>
      ))}
    </ul>
  )
}

/**
 * The browser-driven read, started by an interaction.
 *
 * `readQuery` during render only works in the browser: React refuses a server
 * function call during the initial render, and reaching a query's id means
 * calling its reference. Starting it from a click sidesteps that entirely —
 * for a component that must also server-render, put TanStack Query or SWR on
 * top, whose fetchers run in an effect.
 */
export function BrowserRead() {
  const [asked, setAsked] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setAsked(true)} disabled={asked}>
        Read the experiences
      </button>
      {asked ? <Experiences /> : null}
    </>
  )
}

function Experiences() {
  // BOTH reads started before either is awaited. The order matters as much as
  // it does with Promise.all: `use()` suspends the moment it is called, so
  //
  //     const a = use(readQuery(one, []))
  //     const b = use(readQuery(two, []))
  //
  // never reaches the second line on the first pass — the second read starts
  // only after the first resolves. That is a waterfall, and two requests.
  // Started together, they are one.
  const listingsRead = readQuery(getListings, ['experience'])
  const totalRead = readQuery(getListingCount, [])

  const listings = use(listingsRead)
  const total = use(totalRead)

  return (
    <>
      <ul>
        {listings.map((listing) => (
          <li key={listing}>{listing}</li>
        ))}
      </ul>
      <p>{total} in total</p>
      <Same />
    </>
  )
}

function Same() {
  const listings = use(readQuery(getListings, ['experience']))

  return <p>{listings.length} shown, read twice, fetched once</p>
}
