const state = globalThis as { __flakyHealed?: boolean }

// The service comes back (POST) or goes down again (DELETE).
export async function POST(): Promise<Response> {
  state.__flakyHealed = true

  return new Response(null, { status: 204 })
}

export async function DELETE(): Promise<Response> {
  state.__flakyHealed = false

  return new Response(null, { status: 204 })
}
