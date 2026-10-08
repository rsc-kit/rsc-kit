import { notFound } from '@rsc-kit/core/not-found'

// The same, outside the shop group: the root not-found.tsx answers it.
export default function guard() {
  notFound()
}
