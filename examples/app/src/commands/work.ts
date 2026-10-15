import { defineCommand } from '@rsc-kit/core/commands'

export const description = 'Wait until SIGTERM, then stop'

// Opted in so that a slow register() can be told to stop, which is how a
// command starts with its signal already aborted.
export const register = true

export default defineCommand(async (_args, context) => {
  const { signal } = context

  console.log(signal.aborted ? 'work: started, already told to stop' : 'work: started')

  // Already aborted when the stop came before the command did: an `abort`
  // listener added now would wait for an event that has happened.
  if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))

  // Read now, not destructured above: it is undefined until the stop.
  console.log(`work: stopped, deadline ${typeof context.deadline === 'number' && context.deadline > Date.now() ? 'set' : 'missing'}`)
})
