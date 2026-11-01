'use client'

import { useFlash } from '@rsc-kit/core/useFlash'
import { toast } from 'sonner'
import { Toaster } from '../components/ui/sonner.js'

/** Each message a save or delete flashed, as a toast: "Product saved." on the list the save lands on. */
export function FlashToasts() {
  useFlash(({ message, kind }) => toast[kind](message))

  return <Toaster position="bottom-right" />
}
