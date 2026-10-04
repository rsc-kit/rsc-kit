// The Workers runtime's own module, imported where a request needs a binding.
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>
}
