// The renderer, for an app whose data lives in another process.
//
// createRscHandler already answers a Request with a Response. What every
// backed app then assembles by hand is the same four things: assets off disk,
// prerendered pages off disk, host calls over HTTP, and a build version. None
// of that is the app's decision, and a copy in every project is a copy that
// goes stale against the engine that produced it.
//
// The server itself stays in the app, because that genuinely differs — a port,
// a unix socket, TLS, whatever already supervises processes there.
//
//     import { createBackedHandler } from '@rsc-kit/core/serve'
//     import * as engine from './bootstrap/rsc/vite/dist/rsc/index.js'
//
//     const handle = createBackedHandler({
//       engine,
//       assetsDir: 'public',
//       hostCall: { endpoint: process.env.RSC_HOST_CALL_URL!, secret: process.env.RSC_HOST_CALL_SECRET! },
//     })
//
//     Bun.serve({ fetch: async (r) => (await handle(r)) ?? new Response('Not found', { status: 404 }) })

import { createRscHandler, type RscEngine } from './host.js'
import { httpHostCalls, type HttpHostCallsOptions } from './hostCalls.js'
import { assetsFrom, prerenderedFrom } from './files.js'

export interface BackedHandlerOptions {
  /** The built server bundle — `import * as engine from './dist/rsc/index.js'`. */
  engine: RscEngine

  /**
   * The browser's root, not the asset folder: a request for /assets/x.js reads
   * `<assetsDir>/assets/x.js`.
   *
   * Omit where something in front already serves static files — nginx, a CDN,
   * the backend itself. Passing the asset folder by mistake 404s every asset
   * while every page still renders, so the only symptom is that nothing
   * hydrates and nothing logs.
   */
  assetsDir?: string

  /**
   * The url prefix assets are served under, matching the build's Vite base.
   *
   * Defaults to `/assets/`, which is Vite's. A host that set a base — Laravel's
   * build uses `/build/rsc-vite/` — must pass the same string here, or every
   * asset 404s while every page still renders and nothing hydrates.
   */
  assetsPrefix?: string

  /**
   * Where the build wrote its frozen pages.
   *
   * Missing is an answer, not an error: anything not found there is rendered
   * on demand instead, so a partial prerender is a valid state.
   */
  prerenderedDir?: string

  /** Where rpc() goes. Everything except `fetch` is usually environment. */
  hostCall: HttpHostCallsOptions

  /**
   * Identifies this build to the client, which compares it on every navigation
   * and falls back to a full load when it changes.
   *
   * Without one a client keeps talking to a deployment that no longer exists —
   * worst behind a CDN, where the shell it holds may already be older than the
   * payloads it is asking for.
   */
  version?: string

  /**
   * Props for a page, given whatever its url bound. Defaults to the url params.
   *
   * A backed app that needs more — a tenant, a loaded record — fetches it here
   * with a host call rather than reaching for a database this process has no
   * connection to.
   */
  props?: Parameters<typeof createRscHandler>[0]['props']
}

/**
 * A handler for an app backed by another process.
 */
export function createBackedHandler(
  options: BackedHandlerOptions,
): (request: Request) => Promise<Response | null> {
  return createRscHandler({
    engine: options.engine,
    version: options.version,
    props: options.props,
    assets: options.assetsDir
      ? assetsFrom(options.assetsDir, options.assetsPrefix)
      : undefined,
    prerendered: options.prerenderedDir ? prerenderedFrom(options.prerenderedDir) : undefined,
    hostCalls: httpHostCalls(options.hostCall),
  })
}
