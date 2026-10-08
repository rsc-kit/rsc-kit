import { notFound } from '@rsc-kit/core/not-found'

// Decided before anything is sent, in the shop group: a real 404 carrying the
// shop's not-found.tsx.
export default function guard() {
  notFound()
}
