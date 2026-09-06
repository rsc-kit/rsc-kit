'use server'

// Relative, not '@rsc-kit/core/action': the plugin's alias maps the package
// specifier onto src/js/, and this module is src/action.ts.
import { createActionClient } from '../../../src/action'

const action = createActionClient({ onError: () => 'Something went wrong.' })

export async function greet(name: string) {
  return { message: `Hi ${name} from a server action`, ranAt: 'server' }
}

// Exercises the multipart path: a File argument only survives if the worker
// rebuilds FormData from the raw bytes PHP forwarded.
export async function upload(file: File, label: string) {
  const bytes = new Uint8Array(await file.arrayBuffer())

  return {
    label,
    name: file.name,
    type: file.type,
    size: bytes.length,
    firstBytes: Array.from(bytes.slice(0, 4)),
  }
}

// Calls back into the host, so a test can answer with a refusal and see what
// the worker puts on the wire. PHP turns those frames into a 422, a redirect
// or a 401 — none of which is reachable from an action that never asks.
export async function needsHost(name: string) {
  return await (globalThis as never as { rpc: (fn: string, ...a: unknown[]) => Promise<unknown> }).rpc(
    'checkAccess',
    name,
  )
}

// Reports how many copies of itself were running at once.
//
// Timing cannot answer this: a queue and a pool differ by a few hundred
// milliseconds and a loaded machine covers that. A counter cannot be argued
// with — `peak: 2` means both were inside at the same moment.
let running = 0
let peak = 0

export async function overlapping(label: string, ms: number) {
  running++
  peak = Math.max(peak, running)

  await new Promise((r) => setTimeout(r, ms))

  running--

  return { label, peak }
}

// A form submission validated by the host, not by this process.
//
// There is no error handling here, and that is the point. The host refuses the
// input on its own reply, the transport raises it, and createActionClient
// turns it into the returned { validationErrors } that useForm reads. What
// this used to need was hand-written reshaping that every app would repeat and
// some would get wrong by throwing instead of returning — React serialises a
// rejected server action opaquely, so a thrown validation error reaches the
// browser as "an error occurred" with every field it named gone.
export const createOrder = action.handler(async ({ input }) => {
  const form = input as unknown as FormData | Record<string, unknown>

  // FormData or a plain object, because which one arrives is not the action's
  // to decide. encodeReply serialises a FormData holding only string fields as
  // an object, so an action reaching straight for .get() throws "form.get is
  // not a function" for exactly the submissions that should be simplest.
  const read = (field: string): string => {
    const source = form as FormData

    return String(
      (typeof source.get === 'function' ? source.get(field) : (form as Record<string, unknown>)[field]) ?? '',
    )
  }

  return await (globalThis as any).rpc('Orders.validate', {
    name: read('name'),
    quantity: read('quantity'),
  })
})
