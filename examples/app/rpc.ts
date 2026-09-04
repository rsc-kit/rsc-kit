// Shared by both servers, so the two entry points differ only in framework.
//
// A JS host does not need these at all — a server component can import its
// data module directly, the way src/app/direct/[slug]/page.tsx does. This
// stays as the bridge for a host fronting something it cannot import.
export const rpcFunctions = {
  stats: () => ({ users: 1_284, uptime: '18d 4h' }),
  activity: async () => {
    await new Promise((r) => setTimeout(r, 600))

    return [
      { at: '09:14', what: 'deployed build 4a1c' },
      { at: '08:02', what: 'invited three teammates' },
    ]
  },
  post: (slug: unknown) =>
    slug === 'hello-world'
      ? { title: 'Hello, world', body: 'Rendered on the server, streamed to the browser.' }
      : null,
}
