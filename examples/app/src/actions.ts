'use server'

import { revalidate } from '@rsc-router/core/revalidate'
import { addOrder } from './orders'

let total = 0

// Called straight from a client component as an ordinary async function. The
// body never reaches the browser; the call becomes a POST to /_rsc/action.
export async function addToTotal(amount: number): Promise<number> {
  total += amount

  return total
}

// Marks the orders list stale. The re-rendered list travels back with this
// action's own answer, so the client never makes a second request for it.
export async function placeOrder(item: string): Promise<{ ok: true }> {
  await addOrder(item)
  revalidate('orders')

  return { ok: true }
}
