'use client'

import { useState, type ReactNode } from 'react'
import { renderCard, ask } from './uiActions'

export function CardButton() {
  const [ui, setUi] = useState<ReactNode>(null)

  return (
    <>
      <button id="card-button" onClick={async () => setUi(await renderCard('ada'))}>card</button>
      <button id="ask" onClick={async () => setUi(await ask())}>ask</button>
      {ui}
    </>
  )
}
