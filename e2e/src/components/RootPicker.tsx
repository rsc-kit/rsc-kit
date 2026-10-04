'use client'

import { useSearchParams } from '@rsc-kit/core/useSearchParams'

/** A form field kept in the url, as a folder picker keeps ?root=. */
export function RootPicker() {
  const root = useSearchParams().get('root') ?? '/'

  return <p id="root-picker">root: {root}</p>
}
