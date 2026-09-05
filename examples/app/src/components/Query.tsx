'use client'

import { useSearchParams } from '@rsc-router/core/useSearchParams'

export function Query() {
  const q = useSearchParams().get('q')

  return <p id="q">query: {q ?? '(none)'}</p>
}
