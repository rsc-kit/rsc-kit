// The bakeoff. Starts each server, warms it, measures, stops it.
//
// Same machine, same two pages, production builds, no CDN, nothing cached by
// a proxy. oha with 50 connections for 10 seconds per page; the number that
// matters is p50/p99 time-to-first-byte and requests per second. Client bytes
// are what the document makes the browser fetch: every <script> and
// modulepreload, gzipped, summed - the transfer the page costs before it is
// interactive.

import { spawn } from 'node:child_process'
import { join } from 'node:path'

const HERE = import.meta.dir

type Target = { name: string; cwd: string; cmd: string[]; port: number; env?: Record<string, string> }

const TARGETS: Target[] = [
  { name: 'Next 16 (next start, Node)', cwd: join(HERE, 'next'), cmd: ['npx', 'next', 'start', '-p', '4001'], port: 4001 },
  { name: 'TanStack Start (Nitro, Node)', cwd: join(HERE, 'start'), cmd: ['node', '.output/server/index.mjs'], port: 4002, env: { PORT: '4002' } },
  { name: 'rsc-kit (Nitro, Node)', cwd: join(HERE, 'rsc-kit'), cmd: ['node', '.output/server/index.mjs'], port: 4003, env: { PORT: '4003' } },
  { name: 'rsc-kit (Nitro, Bun)', cwd: join(HERE, 'rsc-kit-bun'), cmd: ['bun', '.output/server/index.mjs'], port: 4005, env: { PORT: '4005' } },
  { name: 'rsc-kit, prerender off (Node)', cwd: join(HERE, 'rsc-kit-live'), cmd: ['node', '.output/server/index.mjs'], port: 4004, env: { PORT: '4004' } },
]

const PAGES = ['/static', '/dynamic']
const DURATION = process.env.DURATION ?? '10s'
const CONNECTIONS = process.env.CONNECTIONS ?? '50'

async function up(port: number, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/static`)
      if (r.ok) return true
    } catch {}
    await Bun.sleep(500)
  }
  return false
}

async function clientBytes(base: string, page: string): Promise<{ html: number; js: number; files: number }> {
  const res = await fetch(base + page, { headers: { 'accept-encoding': 'gzip' } })
  const html = await res.text()
  const htmlGz = Bun.gzipSync(Buffer.from(html)).length
  const urls = new Set<string>()
  for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) urls.add(m[1]!)
  for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) urls.add(m[1]!)
  let js = 0
  for (const u of urls) {
    const r = await fetch(new URL(u, base).href, { headers: { 'accept-encoding': 'gzip' } })
    const buf = new Uint8Array(await r.arrayBuffer())
    // node's fetch decompresses; measure gzipped ourselves for a fair number
    js += Bun.gzipSync(buf).length
  }
  return { html: htmlGz, js, files: urls.size }
}

async function oha(url: string) {
  const proc = Bun.spawn(['oha', '-z', DURATION, '-c', CONNECTIONS, '--no-tui', '--output-format', 'json', url], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const j = JSON.parse(out)
  // Time to first byte, not full latency: a streamed page finishes when its
  // slowest boundary does, and what a visitor feels is when it starts.
  const ttfb = j.firstBytePercentiles
  const full = j.latencyPercentiles
  return {
    rps: j.summary.requestsPerSec as number,
    p50: (ttfb.p50 as number) * 1000,
    p99: (ttfb.p99 as number) * 1000,
    fullP50: (full.p50 as number) * 1000,
    ok: j.statusCodeDistribution?.['200'] ?? 0,
    total: Object.values(j.statusCodeDistribution ?? {}).reduce((a: number, b) => a + (b as number), 0) as number,
  }
}

const rows: string[] = []

for (const t of TARGETS) {
  const child = spawn(t.cmd[0]!, t.cmd.slice(1), { cwd: t.cwd, env: { ...process.env, NODE_ENV: 'production', ...t.env }, stdio: 'ignore' })
  const base = `http://127.0.0.1:${t.port}`
  if (!(await up(t.port))) { console.error(`${t.name}: did not start`); child.kill(); continue }
  // warm: a few hundred requests so JIT and caches are settled
  for (let i = 0; i < 300; i++) await fetch(base + PAGES[i % 2]!)
  for (const page of PAGES) {
    const bytes = await clientBytes(base, page)
    const r = await oha(base + page)
    const line = `| ${t.name} | \`${page}\` | ${Math.round(r.rps).toLocaleString()} | ${r.p50.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.fullP50.toFixed(1)} | ${(bytes.html / 1024).toFixed(1)} | ${(bytes.js / 1024).toFixed(1)} (${bytes.files}) | ${r.ok === r.total ? '100%' : `${((r.ok / r.total) * 100).toFixed(1)}%`} |`
    console.log(line)
    rows.push(line)
  }
  child.kill()
  await Bun.sleep(1000)
}

const table = ['| server | page | req/s | TTFB p50 ms | TTFB p99 ms | full p50 ms | html kB gz | js kB gz (files) | 200s |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |', ...rows].join('\n')
await Bun.write(join(HERE, 'results.md'), table + '\n')
console.log('\nwritten to bench/results.md')
