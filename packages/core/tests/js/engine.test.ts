// Engine-level tests for the vite RSC bundle.
//
// The Pest suite covers the PHP layer with RuntimeBridge mocked, so it never
// exercises the thing the worker actually loads. These build the fixture app
// with build-rsc-vite.ts and assert on what the generated entry renders:
// composition (layouts, parallel slots, intercept overrides), Suspense
// streaming, metadata resolution, client references and server actions.
//
// Run with: bun test tests/js
import { beforeAll, describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { buildFixtureOnce, bundlePath, outDir } from './goHost'

const packageRoot = join(import.meta.dir, '../..')

/**
 * The package's .tmp, created if it is not there.
 *
 * mkdtemp does not make parents, and a clean checkout has no .tmp — so
 * whichever test file ran first used to create it as a side effect, and
 * reordering them turned that into ENOENT on CI and nowhere else.
 */
function tmpRoot(): string {
  const dir = join(packageRoot, '.tmp')

  mkdirSync(dir, { recursive: true })

  return dir
}


const LAYOUTS = [{ component: 'app/layout', props: {} }]

let engine: any

/** Collect a Flight/HTML stream to a string. */
const text = (s: ReadableStream) => new Response(s).text()

/**
 * Read a stream, recording how long after start each marker first appears.
 * Used to assert that a Suspense fallback reaches the client before the
 * slow data it is standing in for.
 */
async function timeline(stream: ReadableStream, markers: string[]) {
  const start = Date.now()
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const seen: Record<string, number> = {}
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (const marker of markers) {
      if (!(marker in seen) && buffer.includes(marker)) seen[marker] = Date.now() - start
    }
  }

  return seen
}

/**
 * The plugin keys server references by a content hash, so the id changes
 * whenever actions.ts does. Recover it from the built module rather than
 * pinning a value that any edit to the fixture would invalidate.
 */
function serverActionId(exportName: string): string {
  const assets = join(outDir, 'dist/rsc/assets')

  for (const file of readdirSync(assets)) {
    const source = readFileSync(join(assets, file), 'utf-8')
    const match = source.match(
      new RegExp(`registerServerReference\\([^,]+,\\s*"([^"]+)",\\s*"${exportName}"\\)`),
    )
    if (match) return `${match[1]}#${exportName}`
  }

  throw new Error(`no registered server action named "${exportName}" in ${assets}`)
}

beforeAll(async () => {
  await buildFixtureOnce()

  // Deliberately not forcing NODE_ENV=production here. It is shared with every
  // other test file in the process, and React only exports act() from its
  // development build — pinning production breaks the useForm suite depending
  // on file order. The assertions below hold in either build.
  engine = await import(bundlePath)
  engine.installHostFn(async (fn: string, ...args: unknown[]) => {
    if (fn === 'getUser') return { display: 'ramon' }
    if (fn === 'slowData') {
      await new Promise((r) => setTimeout(r, (args[0] as number) ?? 50))
      return { value: `arrived after ${args[0]}ms` }
    }
    return null
  })
}, 120_000)

describe('composition', () => {
  test('renders the page inside its layout', async () => {
    const { stream } = await engine.handleRscStream('app/static/page', {}, LAYOUTS, [], {}, {})
    const payload = await text(stream)

    expect(payload).toContain('Static hello from vite engine')
    expect(payload).toContain('"html"')
  })

  test('passes host call results into the tree', async () => {
    const { stream } = await engine.handleRscStream('app/page', { name: 'ramon' }, LAYOUTS, [], {}, {})

    expect(await text(stream)).toContain('ramon')
  })

  test('encodes client components as client references, not markup', async () => {
    const { stream } = await engine.handleRscStream('app/page', {}, LAYOUTS, [], {}, {})
    const payload = await text(stream)

    // "Counter" travels as a client reference row the browser runtime resolves,
    // not as server-rendered markup.
    expect(payload).toMatch(/:I\[.*"Counter"/)
    expect(payload).not.toContain('<button')
  })

  test('emits stylesheet links inside the payload', async () => {
    const { stream } = await engine.handleRscStream('app/static/page', {}, LAYOUTS, [], {}, {})
    const payload = await text(stream)

    expect(payload).toContain('stylesheet')
    expect(payload).toContain('vite-rsc/importer-resources')
  })
})

describe('parallel routes', () => {
  test('renders the default slot component when nothing intercepts', async () => {
    const { stream } = await engine.handleRscStream(
      'app/feed/page', {}, LAYOUTS, [], { modal: 'app/@modal/default' }, {},
    )
    const payload = await text(stream)

    expect(payload).toContain('Feed content')
    expect(payload).toContain('no modal')
    expect(payload).not.toContain('Modal for photo')
  })
})

describe('route interception', () => {
  test('overrides the slot with the interceptor and its target params', async () => {
    const { stream } = await engine.handleRscStream(
      'app/feed/page', {}, LAYOUTS, [], { modal: 'app/@modal/default' },
      { modal: { component: 'app/@modal/(.)photo/[id]/page', props: { id: '123' } } },
    )
    const payload = await text(stream)

    // The referer page still renders, with the interceptor replacing the slot.
    expect(payload).toContain('Feed content')
    expect(payload).toContain('Modal for photo')
    expect(payload).toContain('123')
    expect(payload).not.toContain('no modal')
  })

  test('renders the full page when the route is not intercepted', async () => {
    const { stream } = await engine.handleRscStream('app/photo/[id]/page', { id: '123' }, LAYOUTS, [], {}, {})
    const payload = await text(stream)

    expect(payload).toContain('Full photo')
    expect(payload).not.toContain('Modal for photo')
  })
})

describe('suspense streaming', () => {
  test('sends the loading.tsx fallback before the slow data resolves', async () => {
    const { stream } = await engine.handleRscStream(
      'app/slow3/page', {}, LAYOUTS, ['app/slow3/loading'], {}, {},
    )
    const seen = await timeline(stream, ['loading…', 'arrived after'])

    expect(seen['loading…']).toBeDefined()
    expect(seen['arrived after']).toBeDefined()
    // The fallback must not wait on the data it stands in for.
    expect(seen['loading…']).toBeLessThan(seen['arrived after'])
  })

  test('streams independent boundaries as each resolves', async () => {
    const { stream } = await engine.handleRscStream('app/slow/page', {}, LAYOUTS, [], {}, {})
    const seen = await timeline(stream, ['Shell rendered', 'arrived after 500ms', 'arrived after 3000ms'])

    expect(seen['Shell rendered']).toBeLessThan(seen['arrived after 500ms'])
    expect(seen['arrived after 500ms']).toBeLessThan(seen['arrived after 3000ms'])
  })

  test('puts <title> in the shell rather than behind the slow boundary', async () => {
    const { htmlStream } = await engine.handleRscHtmlStream('app/slow/page', {}, LAYOUTS, [], {}, {})
    const seen = await timeline(htmlStream, ['<title>', 'arrived after 3000ms'])

    expect(seen['<title>']).toBeDefined()
    expect(seen['<title>']).toBeLessThan(seen['arrived after 3000ms'])
  })
})

describe('ppr classification', () => {
  /**
   * The build asks handleRscPprShell to classify each route. It swaps php()
   * for a probe that never resolves, so anything depending on per-request data
   * stays suspended and only the static shell is flushed. The two flags decide
   * whether a page may be frozen whole, cached as a shell, or left dynamic.
   */
  test('reports a page with no host call as fully static', async () => {
    const r = await engine.handleRscPprShell('app/static/page', {}, LAYOUTS, [], {})

    expect(r.usedDynamicApis).toBe(false)
    expect(r.timedOut).toBe(false)
    // A static page renders to completion, so the shell IS the page.
    expect(r.shellHtml).toContain('Static hello from vite engine')
  })

  test('reports a page that awaits the host callable as dynamic', async () => {
    const r = await engine.handleRscPprShell('app/page', {}, LAYOUTS, ['app/loading'], {})

    expect(r.usedDynamicApis).toBe(true)
    expect(r.timedOut).toBe(true)
  })

  test('captures the loading.tsx fallback as the shell when the page itself blocks', async () => {
    const r = await engine.handleRscPprShell('app/page', {}, LAYOUTS, ['app/loading'], {})

    // The page never renders, so the shell is the layout plus the boundary.
    expect(r.shellHtml).toContain('<nav>')
    expect(r.shellHtml).not.toContain('Hello ')
  })

  test('captures the page markup as the shell when only a child is dynamic', async () => {
    // This is the case PPR exists for: a real static shell with a hole in it.
    const r = await engine.handleRscPprShell('app/slow2/page', {}, LAYOUTS, [], {})

    expect(r.usedDynamicApis).toBe(true)
    expect(r.shellHtml).toContain('id="slow2-shell"')
    expect(r.shellHtml).not.toContain('arrived after')
  })

  test('leaves the real host callable installed afterwards', async () => {
    await engine.handleRscPprShell('app/page', {}, LAYOUTS, ['app/loading'], {})

    // The probe must not leak into subsequent request-time renders.
    const { stream } = await engine.handleRscStream('app/page', { name: 'ramon' }, LAYOUTS, [], {}, {})

    expect(await text(stream)).toContain('ramon')
  })
})

describe('metadata', () => {
  test('applies the nearest layout title template to the page title', async () => {
    const md = await engine.resolveMetadata('app/page', {}, LAYOUTS)

    expect(md.title).toBe('Ramon Page · Laravel RSC')
  })

  test('page metadata overrides layout defaults', async () => {
    const md = await engine.resolveMetadata('app/page', {}, LAYOUTS)

    expect(md.description).toBe('A test page')
  })

  test('falls back to the layout default title when the page has none', async () => {
    const md = await engine.resolveMetadata('app/feed/page', {}, LAYOUTS)

    expect(md.title).toBe('Laravel RSC Docs')
  })

  test('renders resolved metadata into the document head', async () => {
    const { htmlStream } = await engine.handleRscHtmlStream('app/page', {}, LAYOUTS, [], {}, {})
    const html = await text(htmlStream)

    expect(html).toContain('<title>Ramon Page · Laravel RSC</title>')
    expect(html).toContain('content="A test page"')
  })
})

describe('server actions', () => {
  test('runs the action and streams its result', async () => {
    const { stream } = await engine.handleAction(serverActionId('greet'), JSON.stringify(['ramon']))
    const payload = await text(stream)

    expect(payload).toContain('Hi ramon from a server action')
  })

  test('takes its arguments as bytes, which is how the worker delivers them', async () => {
    // Every body crosses the socket as bytes on its own frame, upload or not.
    // Handling only the multipart case and leaving the rest empty runs the
    // action with no arguments — which answers 500 and looks like the action
    // itself failed. Nothing caught it: this suite passed a string, and the
    // worker is the only thing that passes bytes.
    const body = new TextEncoder().encode(JSON.stringify(['ramon']))

    const { stream } = await engine.handleAction(
      serverActionId('greet'),
      body,
      'text/plain;charset=UTF-8',
    )

    expect(await text(stream)).toContain('Hi ramon from a server action')
  })
})

describe('loading.tsx validation', () => {
  const LAYOUT = `export default function L({ children }: any) { return <html><body>{children}</body></html> }\n`

  /** What the Laravel package passes; the plugin itself defaults to neither. */
  const LARAVEL_ROUTE_CONFIG = {
    RSC_ROUTE_CONFIG_FILE: 'route.php',
    RSC_ROUTE_CONFIG_PATTERN: 'props\\s*\\(\\s*(fn|function)\\s*\\(',
  }

  /**
   * Build a throwaway app tree and return the engine's exit code + output.
   * Exit 1 means the build rejected it for a missing loading boundary.
   */
  async function buildApp(files: Record<string, string>, routeConfig = LARAVEL_ROUTE_CONFIG) {
    const dir = mkdtempSync(join(tmpdir(), 'larabun-validate-'))
    // The generated entries must sit inside the project so their imports can
    // resolve the project's node_modules; only the app source lives in tmp.
    const buildDir = mkdtempSync(join(tmpRoot(), 'validate-'))

    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), contents)
    }

    const proc = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: dir,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
        // The plugin knows no backend's file conventions; a host supplies them.
        ...routeConfig,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [code, stderr] = [await proc.exited, await new Response(proc.stderr).text()]
    rmSync(dir, { recursive: true, force: true })
    rmSync(buildDir, { recursive: true, force: true })

    return { code, stderr }
  }

  test('rejects a page whose own default export awaits the host callable', async () => {
    const { code, stderr } = await buildApp({
      'app/layout.tsx': LAYOUT,
      'app/blocking/page.tsx':
        `export default async function P() {\n` +
        `  const d: any = await (globalThis as any).rpc('x')\n` +
        `  return <main>{d}</main>\n` +
        `}\n`,
    })

    expect(code).toBe(1)
    expect(stderr).toContain('app/blocking/page')
    expect(stderr).toContain('awaits rpc()')
  })

  test('accepts a blocking page that has a loading.tsx in its chain', async () => {
    const { code } = await buildApp({
      'app/layout.tsx': LAYOUT,
      'app/loading.tsx': `export default function L() { return <div>loading</div> }\n`,
      'app/blocking/page.tsx':
        `export default async function P() {\n` +
        `  const d: any = await (globalThis as any).rpc('x')\n` +
        `  return <main>{d}</main>\n` +
        `}\n`,
    })

    expect(code).toBe(0)
  })

  test('accepts a page that starts a host call without awaiting it', async () => {
    // Starting the call and handing the promise to a client component, which
    // unwraps it with use() inside its own boundary, lets the page paint at
    // once — so no loading.tsx is required even though the default export is
    // async and names rpc().
    const { code } = await buildApp({
      'app/layout.tsx': LAYOUT,
      'app/deferred-promise/page.tsx':
        `import { Suspense } from 'react'\n` +
        `import Stats from './Stats'\n` +
        `export default async function P() {\n` +
        `  const promise: any = (globalThis as any).rpc('Stats.fetch')\n` +
        `  return <Suspense fallback={<i>wait</i>}><Stats p={promise} /></Suspense>\n` +
        `}\n`,
      'app/deferred-promise/Stats.tsx':
        `'use client'\n` +
        `import { use } from 'react'\n` +
        `export default function Stats({ p }: any) { return <p>{String(use(p))}</p> }\n`,
    })

    expect(code).toBe(0)
  })

  test('accepts a page whose slow work sits in a child behind its own Suspense', async () => {
    // The page itself is synchronous, so it paints a shell immediately — no
    // loading.tsx required even though the file calls rpc().
    const { code } = await buildApp({
      'app/layout.tsx': LAYOUT,
      'app/deferred/page.tsx':
        `import { Suspense } from 'react'\n` +
        `async function Slow() {\n` +
        `  const d: any = await (globalThis as any).rpc('x')\n` +
        `  return <p>{d}</p>\n` +
        `}\n` +
        `export default function P() {\n` +
        `  return <main><Suspense fallback={<i>wait</i>}><Slow /></Suspense></main>\n` +
        `}\n`,
    })

    expect(code).toBe(0)
  })

  test('rejects a page whose route.php resolves props() through a closure', async () => {
    const { code, stderr } = await buildApp({
      'app/layout.tsx': LAYOUT,
      'app/dynamic/page.tsx': `export default function P() { return <main>hi</main> }\n`,
      'app/dynamic/route.php': "<?php\n\nreturn route()->props(fn () => ['a' => 1]);\n",
    })

    expect(code).toBe(1)
    expect(stderr).toContain('resolves props dynamically')
  })

  test('ignores viewData() closures, which never reach React', async () => {
    const { code } = await buildApp({
      'app/layout.tsx': LAYOUT,
      'app/blade/page.tsx': `export default function P() { return <main>hi</main> }\n`,
      'app/blade/route.php': "<?php\n\nreturn route()->viewData(fn () => ['title' => 'x']);\n",
    })

    expect(code).toBe(0)
  })
})

describe('app vite config', () => {
  /**
   * The plugin has no opinion about which plugins an app uses — the React
   * Compiler, Tailwind, anything else. An app declares them in its own
   * vite.rsc.config and the engine merges them in.
   */
  async function engineModule() {
    return import(join(packageRoot, 'src/build-rsc-vite.ts'))
  }

  test('finds a vite.rsc.config in the app root', async () => {
    const { findUserViteConfig } = await engineModule()
    const dir = mkdtempSync(join(tmpdir(), 'larabun-cfg-'))
    writeFileSync(join(dir, 'vite.rsc.config.ts'), 'export default {}')

    expect(findUserViteConfig(dir)).toBe(join(dir, 'vite.rsc.config.ts'))

    rmSync(dir, { recursive: true, force: true })
  })

  test('returns null when the app has no config', async () => {
    const { findUserViteConfig } = await engineModule()
    const dir = mkdtempSync(join(tmpdir(), 'larabun-cfg-'))

    expect(findUserViteConfig(dir)).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })

  test('refuses a config that puts a JSX transform ahead of rsc()', async () => {
    // rsc() splits the graph into client and server; a JSX transform running
    // first sees the wrong graph and fails somewhere unrelated. Refuse instead.
    //
    // Vite's own enforce ordering already puts rsc() ahead of a plain plugin,
    // so only a plugin forcing itself early actually inverts the order.
    const app = mkdtempSync(join(tmpdir(), 'larabun-order-'))
    const buildDir = mkdtempSync(join(tmpRoot(), 'cfg-'))
    const configPath = join(buildDir, 'vite.rsc.config.mjs')

    mkdirSync(join(app, 'app'), { recursive: true })
    writeFileSync(
      join(app, 'app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(app, 'app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')
    writeFileSync(
      configPath,
      `import { rscRoutes } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}

export default {
  plugins: [{ name: 'vite:react-babel', enforce: 'pre' }, rscRoutes()],
}
`,
    )

    const proc = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: app,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: configPath,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [code, stderr] = [await proc.exited, await new Response(proc.stderr).text()]

    expect(code).not.toBe(0)
    expect(stderr).toContain('vite:react-babel')
    expect(stderr).toContain('resolved ahead of rsc()')

    rmSync(app, { recursive: true, force: true })
    rmSync(buildDir, { recursive: true, force: true })
  }, 120_000)

  test('applies the app plugins during the build', async () => {
    // Proves the merge actually reaches the build rather than just resolving a
    // path: a plugin that only the app config supplies must transform output.
    const marker = 'RSC_USER_PLUGIN_RAN'
    const app = mkdtempSync(join(tmpdir(), 'larabun-cfgapp-'))
    const buildDir = mkdtempSync(join(tmpRoot(), 'cfg-'))
    const configPath = join(buildDir, 'vite.rsc.config.mjs')

    mkdirSync(join(app, 'app'), { recursive: true })
    writeFileSync(
      join(app, 'app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(app, 'app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')
    // The app composes rscRoutes() itself — this is the documented shape.
    writeFileSync(
      configPath,
      `import { rscRoutes } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}

export default {
  plugins: [
    rscRoutes(),
    {
      name: 'larabun-marker',
      transform(code, id) {
        if (id.includes('entry.browser')) {
          return code + '\\nglobalThis.__marker = "${marker}";\\n'
        }
        return null
      },
    },
  ],
}
`,
    )

    const proc = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: app,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: configPath,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(await proc.exited).toBe(0)

    const assets = join(buildDir, 'public/assets')
    const ran = readdirSync(assets).some((f) =>
      readFileSync(join(assets, f), 'utf-8').includes(marker),
    )

    expect(ran).toBe(true)

    rmSync(app, { recursive: true, force: true })
    rmSync(buildDir, { recursive: true, force: true })
  }, 120_000)
})

describe('form data serialization', () => {
  /**
   * buildFormData is the contract between useForm and a server action, and the
   * client half of native file uploads. The hook itself needs a React renderer,
   * but this is where the encoding decisions live.
   */
  async function build(data: Record<string, unknown>) {
    const { buildFormData } = await import(join(packageRoot, 'src/js/useForm.ts'))

    return buildFormData(data) as FormData
  }

  test('encodes booleans as 1 and 0 so PHP sees something truthy', async () => {
    const fd = await build({ remember: true, subscribed: false })

    expect(fd.get('remember')).toBe('1')
    expect(fd.get('subscribed')).toBe('0')
  })

  test('repeats array values under a bracketed key', async () => {
    const fd = await build({ tags: ['a', 'b'] })

    expect(fd.getAll('tags[]')).toEqual(['a', 'b'])
  })

  test('drops null and undefined rather than sending them as strings', async () => {
    const fd = await build({ name: 'ramon', middle: null, nickname: undefined })

    expect(fd.get('name')).toBe('ramon')
    expect(fd.has('middle')).toBe(false)
    expect(fd.has('nickname')).toBe(false)
  })

  test('passes a File through untouched for native uploads', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    const fd = await build({ avatar: file, name: 'ramon' })
    const sent = fd.get('avatar') as File

    // Not stringified — the binary reaches the action intact.
    expect(sent).toBeInstanceOf(File)
    expect(sent.name).toBe('avatar.png')
    expect(sent.type).toBe('image/png')
    expect(await sent.arrayBuffer()).toHaveLength(3)
  })

  test('stringifies numbers and leaves strings alone', async () => {
    const fd = await build({ age: 41, name: 'ramon' })

    expect(fd.get('age')).toBe('41')
    expect(fd.get('name')).toBe('ramon')
  })
})

describe('file uploads through a server action', () => {
  /**
   * The full client→PHP→worker shape for an upload: encodeReply produces
   * FormData, the client serializes it to bytes under an opaque content-type,
   * and PHP forwards those bytes on their own socket frame.
   *
   * Bytes the whole way. They used to be base64'd into the JSON frame and
   * rebuilt here from a latin1 string, which is what this fixture modelled.
   */
  async function multipartBody(form: FormData) {
    const serialized = new Response(form)
    const contentType = serialized.headers.get('content-type')!

    return { body: new Uint8Array(await serialized.arrayBuffer()), contentType }
  }

  test('reconstructs a File from a multipart body', async () => {
    const { encodeReply } = await import('react-server-dom-webpack/client.edge')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])
    const file = new File([png], 'avatar.png', { type: 'image/png' })

    const encoded = await encodeReply([file, 'profile picture'])
    expect(encoded).toBeInstanceOf(FormData)

    const { body, contentType } = await multipartBody(encoded as FormData)
    const { stream } = await engine.handleAction(serverActionId('upload'), body, contentType)
    const payload = await text(stream)

    expect(payload).toContain('avatar.png')
    expect(payload).toContain('image/png')
    expect(payload).toContain('profile picture')
  })

  test('preserves the exact bytes, including non-UTF8 ones', async () => {
    const { encodeReply } = await import('react-server-dom-webpack/client.edge')
    // 0x89 and 0xFF are invalid UTF-8 on their own — a text round-trip mangles
    // them, which is what the latin1 transport exists to prevent.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff])
    const encoded = await encodeReply([new File([png], 'a.png', { type: 'image/png' }), 'x'])

    const { body, contentType } = await multipartBody(encoded as FormData)
    const { stream } = await engine.handleAction(serverActionId('upload'), body, contentType)
    const payload = await text(stream)

    expect(payload).toContain('"size":10')
    expect(payload).toContain('[137,80,78,71]')
  })

  test('still handles a plain non-multipart action body', async () => {
    const { stream } = await engine.handleAction(serverActionId('greet'), JSON.stringify(['ramon']))

    expect(await text(stream)).toContain('Hi ramon from a server action')
  })
})

describe('package alias', () => {
  test('resolves the client runtime by package specifier', async () => {
    // The fixture's Nav imports Link from 'laravel-rsc/Link'. An unresolved
    // alias fails the build outright, so a rendered <a> is the proof. Nav is a
    // client component, so it only becomes markup in the SSR pass — the Flight
    // payload carries a client reference instead.
    const { htmlStream } = await engine.handleRscHtmlStream('app/feed/page', {}, LAYOUTS, [], {}, {})
    const html = await text(htmlStream)

    expect(html).toContain('id="nav-home"')
    expect(html).toContain('href="/"')
  })
})

/**
 * The client router decides whether a click is an interception before it asks
 * the server, so the patterns have to be in its bundle. Nothing carried them
 * across after the migration: the manifest was never installed, matchIntercept
 * always returned null, and every intercepted link did a full-page navigation.
 *
 * Generated from the plugin's own walk of app/ now, rather than read from a
 * file the host wrote before the build that consumed it. This is the handoff —
 * the part that was untested and therefore the part that broke.
 */
describe('intercept manifest reaches the browser entry', () => {
  function buildApp(withInterceptor: boolean): { entry: string; cleanup: () => void } {
    const app = mkdtempSync(join(tmpdir(), 'larabun-icpt-'))
    const buildDir = mkdtempSync(join(tmpRoot(), 'icpt-'))

    mkdirSync(join(app, 'app'), { recursive: true })
    writeFileSync(
      join(app, 'app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(app, 'app/page.tsx'), 'export default function P() { return <main>hi</main> }\n')

    if (withInterceptor) {
      // A real interceptor on disk: discovery is what produces the manifest
      // now, so there is no file for a host to write.
      mkdirSync(join(app, 'app/@modal/(.)shop/item/[id]'), { recursive: true })
      writeFileSync(
        join(app, 'app/@modal/default.tsx'),
        'export default function D() { return <div>no modal</div> }\n',
      )
      writeFileSync(
        join(app, 'app/@modal/(.)shop/item/[id]/page.tsx'),
        'export default function M() { return <div>modal</div> }\n',
      )
      mkdirSync(join(app, 'app/shop/item/[id]'), { recursive: true })
      writeFileSync(
        join(app, 'app/shop/item/[id]/page.tsx'),
        'export default function I() { return <main>item</main> }\n',
      )
    }

    const configPath = join(buildDir, 'vite.rsc.config.mjs')
    writeFileSync(
      configPath,
      `import { rscRoutes } from ${JSON.stringify(join(packageRoot, 'src/vite.ts'))}\n` +
        'export default { plugins: [rscRoutes()] }\n',
    )

    const proc = Bun.spawnSync(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: app,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: configPath,
      },
    })

    expect(proc.exitCode).toBe(0)

    return {
      entry: readFileSync(join(buildDir, '.gen/entry.browser.tsx'), 'utf-8'),
      cleanup: () => {
        rmSync(app, { recursive: true, force: true })
        rmSync(buildDir, { recursive: true, force: true })
      },
    }
  }

  test('patterns the host publishes are baked into the entry', () => {
    const { entry, cleanup } = buildApp(true)

    // Passed to the bootstrap, not merely present in the file.
    expect(entry).toContain('createViteRscApp(document, [{"urlPattern":"/shop/item/[id]","slot":"modal"}], ')

    cleanup()
  }, 120_000)

  test('an app with no interceptors still boots', () => {
    const { entry, cleanup } = buildApp(false)

    expect(entry).toContain('createViteRscApp(document, [], ')

    cleanup()
  }, 120_000)

})

/**
 * The converse of the route.php rule: the marker only means anything because a
 * host said so. Without that configuration the same file is just a file, which
 * is what keeps the plugin publishable independently of any one backend.
 */
describe('route config is host-supplied', () => {
  test('the same route.php is ignored when no host configures it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'larabun-noconf-'))
    const buildDir = mkdtempSync(join(tmpRoot(), 'validate-'))

    mkdirSync(join(dir, 'app/dynamic'), { recursive: true })
    writeFileSync(
      join(dir, 'app/layout.tsx'),
      'export default function L({ children }: any) { return <html><body>{children}</body></html> }\n',
    )
    writeFileSync(join(dir, 'app/dynamic/page.tsx'), 'export default function P() { return <main>hi</main> }\n')
    writeFileSync(join(dir, 'app/dynamic/route.php'), "<?php\n\nreturn route()->props(fn () => ['a' => 1]);\n")

    const proc = Bun.spawn(['bun', join(packageRoot, 'src/build-rsc-vite.ts')], {
      cwd: packageRoot,
      env: {
        ...process.env,
        RSC_PROJECT_ROOT: packageRoot,
        RSC_SOURCE_DIR: dir,
        RSC_OUT_DIR: buildDir,
        RSC_ASSETS_DIR: join(buildDir, 'public'),
        RSC_VITE_CONFIG: join(packageRoot, 'tests/fixtures/vite.rsc.config.mjs'),
        RSC_ROUTE_CONFIG_FILE: '',
        RSC_ROUTE_CONFIG_PATTERN: '',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const code = await proc.exited
    rmSync(dir, { recursive: true, force: true })
    rmSync(buildDir, { recursive: true, force: true })

    // Builds clean: nothing here knows what a route.php is.
    expect(code).toBe(0)
  }, 120_000)
})

/**
 * Which layout receives a parallel slot.
 *
 * Slots are collected by walking up from the page to the app root, so an
 * @slot directory can sit at any level and belongs to the layout at that
 * level. Composition has to hand it to that layout — not to the innermost
 * one, which may not declare the prop at all.
 *
 * Every other slot test uses a single layout, where innermost and owner are
 * the same directory, so the distinction never showed. These assert on
 * rendered HTML rather than the Flight payload: an unused prop is still
 * serialized, so the payload contains the slot component either way.
 */
describe('slot ownership', () => {
  const NESTED = [
    { component: 'app/layout', props: {} },
    { component: 'app/nested/layout', props: {} },
  ]

  async function renderHtml(layouts: unknown[], overrides: Record<string, unknown> = {}) {
    const { htmlStream } = await engine.handleRscHtmlStream(
      'app/nested/page', {}, layouts, [], { modal: 'app/@modal/default' }, overrides,
    )

    return await new Response(htmlStream).text()
  }

  test('a slot declared at the root renders, even from a page under a deeper layout', async () => {
    const html = await renderHtml(NESTED)

    expect(html).toContain('Nested page content')
    expect(html).toContain('nested-layout')
    // app/layout renders {modal}; app/nested/layout never receives it.
    expect(html).toContain('modal-default')
  })

  test('an interceptor replaces a root-owned slot from a page under a deeper layout', async () => {
    const html = await renderHtml(NESTED, {
      modal: { component: 'app/@modal/(.)photo/[id]/page', props: { id: '7' } },
    })

    expect(html).toContain('Modal for photo')
    expect(html).toContain('nested-layout')
    expect(html).not.toContain('modal-default')
  })

  test('still works when the owning layout is the innermost one', async () => {
    const html = await renderHtml([{ component: 'app/layout', props: {} }])

    expect(html).toContain('modal-default')
  })
})

/**
 * Segment boundaries in the rendered tree.
 *
 * They are the seam a later navigation replaces on its own. Introduced ahead
 * of that so any regression they cause — hydration, prerendering, the client
 * reference count — shows up on its own rather than mixed in with partial
 * responses.
 */
describe('segment boundaries', () => {
  test('travel as a client reference, one per layout', async () => {
    const { stream } = await engine.handleRscStream(
      'app/nested/page',
      {},
      [
        { component: 'app/layout', props: {} },
        { component: 'app/nested/layout', props: {} },
      ],
      [], {}, {},
    )
    const payload = await text(stream)

    // A client reference, not server-rendered markup: the browser resolves it
    // so the boundary can re-render without the server.
    expect(payload).toMatch(/:I\[.*"SegmentBoundary"/)
  })

  test('add no markup of their own', async () => {
    const { htmlStream } = await engine.handleRscHtmlStream(
      'app/static/page', {}, LAYOUTS, [], {}, {},
    )
    const html = await new Response(htmlStream).text()

    expect(html).toContain('Static hello from vite engine')
    // The boundary renders its children directly — nothing wraps them.
    expect(html).not.toContain('segment-boundary')
  })

  test('do not make a static page look dynamic to the prerenderer', async () => {
    // The boundary is a client component, but it touches no host call, so a
    // page that was fully prerenderable must stay so.
    const shell = await engine.handleRscPprShell('app/static/page', {}, LAYOUTS, [], {})

    expect(shell.usedDynamicApis).toBe(false)
    expect(shell.timedOut).toBe(false)
    expect(shell.shellHtml).toContain('Static hello from vite engine')
  })
})

/**
 * Partial renders.
 *
 * A navigation between two pages under the same layouts only has to send what
 * changed. `from` names how many layouts the client already has mounted; the
 * engine renders from there down and reports the depth it actually produced,
 * which is not always the one it was asked for.
 */
describe('segment rendering', () => {
  const NESTED = [
    { component: 'app/layout', props: {} },
    { component: 'app/nested/layout', props: {} },
  ]

  async function render(from: number, overrides: Record<string, unknown> = {}) {
    const result = await engine.handleRscStream(
      'app/nested/page', {}, NESTED, [], { modal: 'app/@modal/default' }, overrides, from,
    )

    return { payload: await text(result.stream), depth: result.segmentDepth }
  }

  test('from 0 renders the whole document, as before', async () => {
    const { payload, depth } = await render(0)

    expect(depth).toBe(0)
    expect(payload).toContain('"html"')
    expect(payload).toContain('Nested page content')
  })

  test('skipping the root layout leaves <html> out of the payload', async () => {
    const { payload, depth } = await render(1)

    expect(depth).toBe(1)
    expect(payload).toContain('Nested page content')
    expect(payload).toContain('nested-layout')
    // The client still has <html> mounted; resending it is the waste this removes.
    expect(payload).not.toContain('"html"')
  })

  test('skipping every layout sends the page alone', async () => {
    const { payload, depth } = await render(2)

    expect(depth).toBe(2)
    expect(payload).toContain('Nested page content')
    expect(payload).not.toContain('nested-layout')
  })

  test('still carries the title, which an outer layout templates', async () => {
    // Metadata resolves against the full chain even when composition does not,
    // so a partial render produces the same <title> as a whole document.
    const { payload } = await render(2)

    expect(payload).toContain('Laravel RSC')
  })

  test('widens the render when an interceptor targets a layout being skipped', async () => {
    // @modal is declared at app/, owned by the root layout. Honouring from: 2
    // would render the page alone and the modal would never appear.
    const { payload, depth } = await render(2, {
      modal: { component: 'app/@modal/(.)photo/[id]/page', props: { id: '9' } },
    })

    expect(depth).toBe(0)
    expect(payload).toContain('Modal for photo')
  })
})

/**
 * A route that ships no client runtime.
 *
 * React Server Components keep an application's own code off the client, but
 * the runtime floor stays: react-dom alone is ~54kB gzip, paid the moment
 * anything hydrates. A page with nothing interactive on it has no use for that,
 * and can be HTML and nothing else.
 */
describe('rendering without a client bootstrap', () => {
  test('emits no bootstrap script', async () => {
    const { htmlStream } = await engine.handleRscHtmlStream(
      'app/static/page', {}, LAYOUTS, [], {}, {}, undefined, '', false,
    )
    const html = await new Response(htmlStream).text()

    expect(html).toContain('Static hello from vite engine')
    // The bootstrap is what pulls in React, the Flight client and the router.
    expect(html).not.toContain('<script')
  })

  test('still emits it by default', async () => {
    const { htmlStream } = await engine.handleRscHtmlStream(
      'app/static/page', {}, LAYOUTS, [], {}, {},
    )
    const html = await new Response(htmlStream).text()

    expect(html).toContain('<script')
  })

  test('leaves out the segment boundary, which is itself a client component', async () => {
    // With one in the tree no page could ever be JS-free: every layout would
    // drag React in for a seam nothing without a runtime can use. The fixture's
    // layout has client components of its own, which is the app's choice — the
    // boundary is the engine's, and must not be imposed.
    const withRuntime = await engine.handleRsc('app/static/page', {}, null, LAYOUTS, [], {})
    const without = await engine.handleRsc('app/static/page', {}, null, LAYOUTS, [], {}, 0, '', false)

    expect(withRuntime.clientComponents).toContain('SegmentBoundary')
    expect(without.clientComponents).not.toContain('SegmentBoundary')
  })

  test('reports the client components that would force a runtime', async () => {
    // app/page renders Counter, so it names it rather than failing silently.
    const result = await engine.handleRsc('app/page', {}, null, LAYOUTS, [], {}, 0, '', false)

    expect(result.clientComponents.length).toBeGreaterThan(0)
  })
})

describe('what an action invalidated, rendered into its own answer', () => {
  const PAGE = {
    component: 'app/page',
    props: { name: 'ramon' },
    layouts: LAYOUTS,
    loadings: [],
    parallelSlots: { modal: 'app/@modal/default' },
  }

  const body = () => new TextEncoder().encode(JSON.stringify(['ramon']))

  test('an action that marks nothing answers with just its result', async () => {
    // Most actions return what changed and the caller sets it. Those must not
    // pay for a render nobody asked for.
    const { stream } = await engine.handleAction(
      serverActionId('greet'),
      body(),
      'text/plain;charset=UTF-8',
      PAGE,
      () => [],
    )

    const payload = await text(stream)

    expect(payload).toContain('Hi ramon from a server action')
    expect(payload).not.toContain('revalidated')
  })

  test('a marked slot is rendered and travels with the result', async () => {
    // One round trip: the browser is not told what went stale and asked to
    // come back for it.
    const { stream } = await engine.handleAction(
      serverActionId('greet'),
      body(),
      'text/plain;charset=UTF-8',
      PAGE,
      () => ['modal'],
    )

    const payload = await text(stream)

    expect(payload).toContain('Hi ramon from a server action')
    expect(payload).toContain('modal-default')
  })

  test('the page target re-renders below the layouts, not the layouts', async () => {
    const { stream } = await engine.handleAction(
      serverActionId('greet'),
      body(),
      'text/plain;charset=UTF-8',
      PAGE,
      () => ['page'],
    )

    const payload = await text(stream)

    expect(payload).toContain('ramon')
    // The layout is above the boundary being replaced, so it is not sent.
    expect(payload).not.toContain('html')
  })

  test('the all target re-renders the layouts too', async () => {
    const { stream } = await engine.handleAction(
      serverActionId('greet'),
      body(),
      'text/plain;charset=UTF-8',
      PAGE,
      () => ['all'],
    )

    // The document element only appears when the chain is rendered from the top.
    expect(await text(stream)).toContain('html')
  })

  test('a slot the page does not have says which ones it has', async () => {
    // Naming a slot that is not on the page is a typo, and silently rendering
    // nothing would look like the action failing to change anything.
    const failing = engine.handleAction(
      serverActionId('greet'),
      body(),
      'text/plain;charset=UTF-8',
      PAGE,
      () => ['nope'],
    )

    await expect(failing).rejects.toThrow('modal')
  })
})

describe('a section: a named region of a page', () => {
  const LEDGER = {
    component: 'app/ledger/page',
    props: {},
    layouts: LAYOUTS,
    loadings: [],
    parallelSlots: {},
  }

  test('renders in place, inside a boundary the client can swap', async () => {
    const { rscPayload } = await engine.handleRscPayload(
      'app/ledger/page', {}, LAYOUTS, [], {}, 0, '/ledger',
    )

    expect(rscPayload).toContain('orders render')
    expect(rscPayload).toContain('SlotBoundary')
  })

  test('is rendered on its own, without the page around it', async () => {
    // The point of naming it: one region re-rendered, not the whole page.
    const { rscPayload } = await engine.handleRscRevalidate('orders', LEDGER)

    expect(rscPayload).toContain('orders render')
    expect(rscPayload).not.toContain('Ledger')
  })

  test('does not send its own boundary back, so refreshes do not nest', async () => {
    // The client replaces what is inside the boundary. Returning the wrapper
    // would put a new boundary inside the old one, once per refresh, for ever.
    const first = await engine.handleRscRevalidate('orders', LEDGER)
    const second = await engine.handleRscRevalidate('orders', LEDGER)

    expect(first.rscPayload).not.toContain('SlotBoundary')
    expect(second.rscPayload).not.toContain('SlotBoundary')
  })

  test('an unknown name says which names there are', async () => {
    // Naming one that does not exist is a typo, and rendering nothing would
    // look like the mutation having failed to change anything.
    await expect(engine.handleRscRevalidate('nope', LEDGER)).rejects.toThrow('orders')
  })

  test('a slot still resolves, so both kinds of region work', async () => {
    const withSlot = { ...LEDGER, parallelSlots: { modal: 'app/@modal/default' } }

    expect((await engine.handleRscRevalidate('modal', withSlot)).rscPayload)
      .toContain('modal-default')
  })
})

describe('the urls a route declares', () => {
  test('are reached by calling the page export through the bundle', async () => {
    // A generated map that never executes is the failure this catches: the
    // manifest would still say staticParams, and the prerenderer would get
    // nothing back with nothing to say why.
    expect(await engine.getStaticParams('app/photo/[id]/page')).toEqual([{ id: '1' }, { id: '2' }])
  })

  test('a route that declares none says so, rather than declaring none', async () => {
    // null and [] are different answers. No generateStaticParams means render
    // on demand; an empty array means the app looked and found nothing to
    // build. Collapsing them prerenders nothing for a route that wanted
    // everything, or the reverse.
    expect(await engine.getStaticParams('app/page')).toBeNull()
  })
})

describe('the route table the bundle carries', () => {
  test('is the one this build produced', async () => {
    // Embedded so a host cannot pair a fresh bundle with a stale routes.json:
    // the two came out of the same build and now cannot be separated. A host
    // that cannot import a JS module still reads the file.
    const embedded = engine.manifest()
    const onDisk = JSON.parse(readFileSync(join(outDir, 'routes.json'), 'utf-8'))

    expect(embedded.routes.map((r: { component: string }) => r.component).sort()).toEqual(
      onDisk.routes.map((r: { component: string }) => r.component).sort(),
    )
    expect(embedded.intercepts).toEqual(onDisk.intercepts)
  })
})

describe('a route guard', () => {
  test('runs even when the caller says it holds every layout', async () => {
    // The forged-chain attack at the layer that decides it: from=2 claims both
    // layouts are mounted, so neither renders. The guard is not part of that
    // arithmetic and runs anyway.
    const chain = [
      { component: 'app/layout', props: {} },
      { component: 'app/guarded/layout', props: {} },
    ]

    const attempt = engine.handleRscStream('app/guarded/page', {}, chain, [], {}, {}, 2, '/guarded')

    await expect(attempt).rejects.toThrow('Redirect to /login')
  })

  test('and a revalidation cannot reach past it either', async () => {
    const page = {
      component: 'app/guarded/page',
      props: {},
      layouts: [
        { component: 'app/layout', props: {} },
        { component: 'app/guarded/layout', props: {} },
      ],
      loadings: [],
      parallelSlots: {},
    }

    await expect(engine.handleRscRevalidate('page', page)).rejects.toThrow('Redirect to /login')
  })

  test('and a full document render', async () => {
    const chain = [{ component: 'app/layout', props: {} }]

    await expect(
      engine.handleRscHtmlStream('app/guarded/page', {}, chain, [], {}, {}, undefined, '/guarded'),
    ).rejects.toThrow('Redirect to /login')
  })

  test('but not the build, which has no request to allow', async () => {
    // handleRsc is the prerenderer's renderer. Running a guard there would
    // refuse every time — there is nobody to allow — and no page behind a
    // guard could ever be frozen.
    const chain = [{ component: 'app/layout', props: {} }]

    const { body } = await engine.handleRsc('app/guarded/page', {}, null, chain, [], {}, 0, '/guarded')

    expect(body).toContain('GUARDED CONTENT')
  })

  test('a route with no guard is untouched, so the optimisation survives', async () => {
    // If the fix worked by refusing partial renders, nothing else here would
    // notice and navigation would silently stop being partial.
    const { stream, segmentDepth } = await engine.handleRscStream(
      'app/page', {}, LAYOUTS, [], {}, {}, 1, '/',
    )

    expect(segmentDepth).toBe(1)
    expect(await new Response(stream).text()).toBeTruthy()
  })
})
