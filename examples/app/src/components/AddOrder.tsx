'use client'

import { useState } from 'react'
import { placeOrder } from '../actions'

export function AddOrder() {
  const [item, setItem] = useState('')
  const [note, setNote] = useState('')

  return (
    <div className="add-order">
      <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" id="item" />
      <button
        id="place"
        onClick={async () => {
          await placeOrder(item)
          setItem('')
        }}
      >
        Place order
      </button>
      {/* Deliberately untouched by the action: proof the page was not replaced. */}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note" id="note" />
    </div>
  )
}
