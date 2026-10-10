import { notFound } from '@rsc-kit/core/not-found'

// Only acme exists. Anything else is this app's 404 - decided before anything is
// sent, and never handed to the backend: a page that says notFound() is not
// "a url nothing owns".
export default function guard(params: Record<string, string>) {
  if (params.team !== 'acme') notFound()
}
