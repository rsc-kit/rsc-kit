// Process setup, and a marker the commands read to show whether register() ran.

declare global {
  var __registered: boolean | undefined
}

export async function register() {
  globalThis.__registered = true
}
