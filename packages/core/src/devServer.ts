/**
 * Vite dev server mode for the RSC worker.
 *
 * In a build the worker imports a bundled entry. Here it imports the entry
 * through Vite's runnable `rsc` environment instead, so a source edit is
 * picked up without a rebuild. The module shape is identical either way —
 * installHostFn / handleRsc* / handleAction / resolveMetadata — so nothing
 * downstream of the load knows which mode it is in.
 *
 * The host keeps serving the page; the dev server only answers module
 * requests, which is the arrangement a Laravel developer already has with
 * Vite. See devUrls.ts for how the browser is pointed at it.
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Vite resolved the way @vitejs/plugin-rsc resolves it.
 *
 * `isRunnableDevEnvironment` is an instanceof check, and plugin-rsc calls it
 * against its own copy. Two copies of Vite — this package's and the app's, the
 * ordinary case when the package is vendored rather than installed from npm —
 * make a perfectly runnable environment report false, and the error names the
 * environment rather than the duplication. A build never reaches that code
 * path, so the mismatch is invisible until dev mode.
 */
async function resolveViteAsPluginRscDoes(): Promise<typeof import('vite')> {
  const here = createRequire(import.meta.url)

  try {
    const pluginRsc = here.resolve('@vitejs/plugin-rsc')
    const fromPlugin = createRequire(pluginRsc)
    return (await import(fromPlugin.resolve('vite'))) as typeof import('vite')
  } catch {
    // Single copy, or a layout where plugin-rsc is not resolvable from here.
    return (await import('vite')) as typeof import('vite')
  }
}

export interface DevServerOptions {
  /** Project root — where the app's vite config lives. */
  projectRoot: string
  /** Config file to run. The build resolves this the same way. */
  configFile: string
  /** Generated rsc entry to import through the runnable environment. */
  entry: string
  /** Port to listen on. */
  port: number
}

export interface DevServer {
  handler: Record<string, unknown>
  close: () => Promise<void>
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const vite = await resolveViteAsPluginRscDoes()

  const server = await vite.createServer({
    root: options.projectRoot,
    configFile: options.configFile,
    server: {
      port: options.port,
      strictPort: true,
      // The host serves the page from its own origin, so every module request
      // is cross-origin. Dev only.
      cors: true,
    },
  })

  await server.listen()

  const env = server.environments.rsc

  if (!env) {
    await server.close()
    throw new Error("[rsc-kit] no 'rsc' environment — is rscRoutes() in the vite config?")
  }

  if (!vite.isRunnableDevEnvironment(env)) {
    await server.close()
    throw new Error(
      "[rsc-kit] the 'rsc' environment is not runnable.\n" +
        'This usually means two copies of Vite are installed and the plugin is ' +
        'checking against a different one than created this server.',
    )
  }

  const handler = (await env.runner.import(options.entry)) as Record<string, unknown>

  return { handler, close: () => server.close() }
}

/** Entry the dev server imports, matching where the plugin generates it. */
export function devEntryPath(outDir: string): string {
  return join(outDir, '.gen', 'entry.rsc.tsx')
}
