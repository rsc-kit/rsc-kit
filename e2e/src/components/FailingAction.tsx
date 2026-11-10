'use client'

import { useState } from 'react'
import { notifyMe } from '../actions'

export function FailingAction() {
  const [said, setSaid] = useState('idle')

  return (
    <button
      id="notify"
      onClick={async () => {
        try {
          await notifyMe()
          setSaid('success')
        } catch (error) {
          setSaid('failed: ' + (error as Error).message)
        }
      }}
    >
      {said}
    </button>
  )
}
