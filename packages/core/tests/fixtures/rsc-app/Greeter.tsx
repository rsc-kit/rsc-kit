'use client'

import { useState } from 'react'
import { greet } from './actions'

export function Greeter() {
  const [msg, setMsg] = useState('')
  return (
    <button id="greet" onClick={async () => setMsg((await greet('ada')).message)}>
      {msg || 'greet'}
    </button>
  )
}
