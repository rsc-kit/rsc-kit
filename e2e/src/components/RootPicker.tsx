'use client'

import { useSearchParams } from '@rsc-kit/core/useSearchParams'

/** A form field kept in the url, as a folder picker keeps ?root=. */
export function RootPicker({ id = 'root-picker' }: { id?: string }) {
  const root = useSearchParams().get('root') ?? '/'

  return <p id={id}>root: {root}</p>
}
