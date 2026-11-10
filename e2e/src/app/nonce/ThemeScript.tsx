'use client'

import { useEffect } from 'react'
import { useNonce } from '@rsc-kit/core/useNonce'

export function ThemeScript() {
  const nonce = useNonce()

  useEffect(() => {
    // Only where there is a nonce: a style inserted after hydration on a
    // page allowed by hash has nothing to run by, and is meant to be refused.
    if (!nonce) return

    const style = document.createElement('style')

    style.nonce = nonce
    style.textContent = 'body { --inserted: 1 }'
    document.head.append(style)
  }, [nonce])

  return (
    <script
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: "document.documentElement.dataset.theme = 'dark'" }}
    />
  )
}
