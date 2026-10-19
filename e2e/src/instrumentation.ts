import type { ServedRequest } from '@rsc-kit/core/request'

// What a request logger is told, kept for the journeys to read back
// (/api/served). Every journey runs through it, so a page that stopped
// streaming under it would show up in all of them.
const log = ((globalThis as { __served?: Array<Omit<ServedRequest, 'error'> & { error?: string }> }).__served ??= [])

export const onRequestHeaders = ['x-trace']

export function onRequest({ error, ...served }: ServedRequest) {
  if (!served.headers['x-trace']) return

  log.push({ ...served, ...(error === undefined ? {} : { error: String(error) }) })
}
