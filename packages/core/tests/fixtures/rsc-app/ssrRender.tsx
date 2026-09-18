"use ssr";

// Rendered where react-dom/server can run - the ssr environment - and called
// from a server action. The component uses a hook, which the server-components
// environment's React does not have: proof the whole module runs over there.
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

function Card({ title }: { title: string }) {
  const [n] = useState(1)

  return <p>Card {n}: {title}</p>
}

export async function renderCard(title: string): Promise<string> {
  return renderToStaticMarkup(<Card title={title} />)
}
