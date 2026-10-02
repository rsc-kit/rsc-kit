import { mock } from 'bun:test'

// The build honours this import and resolves it to nothing on the server;
// the real package throws when imported, which is what a test would hit.
mock.module('server-only', () => ({}))
mock.module('client-only', () => ({}))

// The build answers next/headers with @rsc-kit/core/request, so a library
// written for Next - Vercel's flags/next - runs without Next. A test is not
// built: without this it finds Next's own, or nothing, and throws.
mock.module('next/headers', () => import('@rsc-kit/core/request'))
