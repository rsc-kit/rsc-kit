'use server'

// Relative, not '@rsc-kit/core/action': the plugin's alias maps the package
// specifier onto src/js/, and this module is src/action.ts.
import { createActionClient, fieldErrors } from '../../../src/action'
import { renderCard } from './ssrRender'

const action = createActionClient({ onError: () => 'Something went wrong.' })

// No action client at all. The engine converts the throw on the way out, so a
// plain function reports a field error the same way a handler does.
export async function claim(handle: string) {
  if (handle === 'taken') return fieldErrors({ handle: 'Already taken' })

  return { handle }
}

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

// A schema on an action: validated by the engine, on the server, with the
// same helper the form uses in the browser. Hand-written to the Standard
// Schema contract, so the fixture depends on no library. The helper carried
// "use client" once, and this call reached a client-reference stub instead:
// "client reference export 'validateWith' is called on server".
const named = {
  '~standard': {
    version: 1,
    vendor: 'fixture',
    validate: (value: unknown) => {
      const name = (value as { name?: unknown } | null)?.name

      return typeof name === 'string' && name.length > 0
        ? { value: { name } }
        : { issues: [{ message: 'A name is required', path: ['name'] }] }
    },
  },
} as const

export const rename = action.input(named as never).handler(async ({ input }) => ({
  renamed: (input as { name: string }).name,
}))

// HTML rendered by react-dom/server, from an action: the module that renders
// carries "use ssr", and this call crosses into the ssr environment.
export async function card(title: string) {
  return { html: await renderCard(title) }
}
