'use server'

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
