export const description = 'Wait until SIGTERM, then stop'

export default async function (_args: string[], { signal }: { signal: AbortSignal }) {
  console.log('work: started')

  // Already aborted when the stop came while the app was loading: an `abort`
  // listener added now would wait for an event that has happened.
  if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))

  console.log('work: stopped')
}
