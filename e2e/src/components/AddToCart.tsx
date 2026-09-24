'use client'

import { useActionState } from 'react'
import { addToCart } from '../actions'

export function AddToCart({ product }: { product: string }) {
  const [message, action, pending] = useActionState(addToCart, null)

  return (
    <form action={action}>
      <input type="hidden" name="product" value={product} />
      <button id="add">Add to cart</button>
      {pending && <span id="adding">adding</span>}
      {!pending && message && <span id="added">{message}</span>}
    </form>
  )
}
