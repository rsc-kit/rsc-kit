#!/usr/bin/env node
/**
 * Checks a running server against the edge contract (v2), nonceShells included.
 *
 *   EDGE_TOKEN=<token> node scripts/edge-conformance.mjs <.output dir> <base url> \
 *     [--unlisted /path] [--guarded /path] [--sample '/posts/[slug]=/posts/hello'] \
 *     [--query '/search?q=edge-check']
 *
 * Framework-neutral on purpose: it reads only the marker and speaks only the
 * contract's endpoints, so any implementation - and the platform holding a
 * copy - can run it. The server must have been started with the same
 * EDGE_TOKEN; a second check is made without it.
 *
 * A listed pattern is checked only through a --sample, because which values
 * of a parameter render a page is the app's to say. --query names a listed
 * page whose holes print the value of the url's first query parameter, so
 * the check can see that a resume rendered for the visitor's query.
 *
 * --guarded names a page the framework must keep out: in neither list, and a
 * 404 from the page endpoint. The strongest one to name is a page whose
 * response a rule changes in a way an edge could not repeat - a middleware,
 * or a header rule setting a header off the contract's list.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const [outDir, base, ...rest] = process.argv.slice(2)
const token = process.env.EDGE_TOKEN ?? ''
const flags = { unlisted: [], guarded: [], sample: [], query: [] }

for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, '')]?.push(rest[i + 1])

if (!outDir || !base || !token) {
  console.error('usage: EDGE_TOKEN=… edge-conformance.mjs <.output dir> <base url> [--unlisted p] [--guarded p] [--sample pattern=path] [--query url]')
  process.exit(2)
}

let failed = 0
const fail = (what) => {
  failed++
  console.log(`  ✗ ${what}`)
}
const pass = (what) => console.log(`  ✓ ${what}`)
const check = (ok, what) => (ok ? pass(what) : fail(what))

// The marker.
const file = join(outDir, 'edge.json')

if (!existsSync(file)) {
  console.log(`✗ no ${file}`)
  process.exit(1)
}

const marker = JSON.parse(readFileSync(file, 'utf8'))
const bytes = (s) => new TextEncoder().encode(s).length

console.log('marker')
check(marker.v === 2, 'v is 2')
check(typeof marker.build === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(marker.build), 'build is 1-128 bytes of [A-Za-z0-9._-]')
check(Array.isArray(marker.shells), 'shells is a list')
check(marker.shells.length <= 200, 'at most 200 shells')
check(new Set(marker.shells).size === marker.shells.length, 'no duplicates')
check(
  marker.shells.every(
    (p) =>
      typeof p === 'string' &&
      p.startsWith('/') &&
      bytes(p) <= 200 &&
      !/[?#]/.test(p) &&
      !p.includes('[[') &&
      (p === '/' || p.slice(1).split('/').every((s) => s !== '' && s !== '.' && s !== '..')) &&
      p.split('/').every((s, i, all) => !s.startsWith('[...') || i === all.length - 1),
  ),
  'every shell is an absolute, decoded path of at most 200 bytes, a catch-all only last',
)
const statics = marker.static ?? []
check(Array.isArray(statics), 'static is a list')
check(statics.length <= 200, 'at most 200 static')
check(new Set(statics).size === statics.length, 'no duplicate static')
check(
  statics.every(
    (p) =>
      typeof p === 'string' &&
      p.startsWith('/') &&
      bytes(p) <= 200 &&
      !/[?#[\]]/.test(p) &&
      (p === '/' || p.slice(1).split('/').every((s) => s !== '' && s !== '.' && s !== '..')),
  ),
  'every static is an absolute, decoded, concrete path of at most 200 bytes',
)
check(!statics.some((p) => marker.shells.includes(p)), 'no path is in both lists')
for (const list of ['headers', 'query', 'cookies']) {
  const names = marker.bypass?.[list] ?? []
  check(Array.isArray(names) && names.length <= 32, `bypass.${list} is at most 32 names`)
}

// nonceShells: optional, for a build under a Content-Security-Policy - the
// shells only an edge minting a nonce per response (Edge-Accept: nonce) may
// serve. An edge that does not reads `shells` alone.
const nonceShells = marker.nonceShells ?? []
check(marker.nonceShells !== null && Array.isArray(nonceShells) && nonceShells.length <= 200, 'nonceShells, if any, is a list of at most 200, never null')
check(!nonceShells.some((p) => marker.shells.includes(p) || statics.includes(p)), 'no nonce shell is in another list')

const shellOf = (path, headers = { 'Edge-Token': token }) =>
  fetch(`${base}/_edge/page?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json', ...headers } })
const resumeOf = (url, state, headers = { 'Edge-Token': token }) =>
  fetch(`${base}/_edge/resume?url=${encodeURIComponent(url)}`, {
    method: 'POST',
    // As if the edge had forgotten to drop it: the resume must come back
    // plain regardless, or its bytes land compressed in the middle of a page.
    headers: { 'Content-Type': 'application/octet-stream', 'Accept-Encoding': 'gzip, br', ...headers },
    body: state,
  })
// The contract's `headers`: optional, from its list, at most 16, and what the
// page itself goes out with - an edge sends them with its copy.
const ALLOWED = new Set(
  [
    'Content-Language', 'Link', 'Cache-Control', 'X-Robots-Tag', 'Content-Security-Policy', 'Content-Security-Policy-Report-Only', 'Permissions-Policy',
    'Referrer-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options',
    'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy', 'Cross-Origin-Resource-Policy', 'X-DNS-Prefetch-Control',
  ].map((name) => name.toLowerCase()),
)
const checkHeaders = (headers, direct) => {
  if (headers === undefined) return
  const entries = Object.entries(headers ?? {})
  check(
    headers !== null && typeof headers === 'object' && entries.length <= 16 && entries.every(([n, v]) => ALLOWED.has(n.toLowerCase()) && typeof v === 'string'),
    'headers are at most 16, each from the allowed list',
  )
  const differ = entries.filter(([n, v]) => direct.headers.get(n) !== v).map(([n]) => n)
  check(differ.length === 0, `and the page served directly has each${differ.length ? `: not ${differ.join(', ')}` : ''}`)
}

// Answered only for the token, so nothing on the way may keep it.
// The contract's `private, no-store`, both directives: `no-store` alone still
// lets a shared cache that ignores it keep a copy.
const unstored = (response) => {
  const directives = (response.headers.get('Cache-Control') ?? '').toLowerCase().split(',').map((d) => d.trim())

  return directives.includes('private') && directives.includes('no-store')
}
// A marker pattern against a path: `[name]` is one segment, a final `[...name]` one or more.
const matches = (pattern, path) => {
  const want = pattern.split('/')
  const have = path.split('/')

  for (const [i, part] of want.entries()) {
    if (i === want.length - 1 && /^\[\.\.\..+\]$/.test(part)) return have.length > i && have.slice(i).every(Boolean)
    if (have[i] === undefined || (/^\[.+\]$/.test(part) ? have[i] === '' : part !== have[i])) return false
  }

  return want.length === have.length
}

const samples = Object.fromEntries(flags.sample.map((s) => s.split('=')))
const paths = marker.shells.flatMap((p) => (p.includes('[') ? (samples[p] ? [samples[p]] : []) : [p]))

for (const path of paths) {
  console.log(path)

  const shell = await shellOf(path)

  if (shell.status !== 200) {
    fail(`shell is ${shell.status}, not 200`)
    continue
  }

  check(shell.headers.get('Edge-Build') === marker.build, 'shell says the marker\'s build')
  check(unstored(shell), 'shell is Cache-Control: private, no-store')
  const body = await shell.json()
  check(body.v === 2 && body.build === marker.build && typeof body.html === 'string' && typeof body.state === 'string', 'shell is { v, build, html, state }')
  check(!body.complete, 'and not complete')
  check(!('nonce' in body), 'and names no nonce: a plain shell needs none')

  const etag = shell.headers.get('ETag')
  if (etag) check((await shellOf(path, { 'Edge-Token': token, 'If-None-Match': etag })).status === 304, 'If-None-Match is a 304')

  const resumed = await resumeOf(path, body.state)
  const holes = await resumed.text()
  check(resumed.status === 200, `resume is ${resumed.status}`)
  check((resumed.headers.get('Content-Type') ?? '').startsWith('text/html'), 'resume is text/html')
  check(resumed.headers.get('Edge-Build') === marker.build, 'resume says the marker\'s build')
  check(unstored(resumed), 'resume is Cache-Control: private, no-store')
  check(!resumed.headers.get('Content-Encoding'), 'resume is not compressed, though the request accepted gzip')
  check(!/<!DOCTYPE|<html[\s>]/i.test(holes), 'resume never starts a second document')

  const page = body.html + holes
  check(/^\s*<!DOCTYPE html>/i.test(page) && /<\/html>\s*$/i.test(page) && (page.match(/<html[\s>]/gi) ?? []).length === 1, 'shell + holes is one document')

  const served = await fetch(`${base}${encodeURI(path)}`, { headers: { Accept: 'text/html' } })
  const direct = await served.text()
  const title = (html) => html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null
  check(title(page) === title(direct), 'and it is the page served directly (by its title)')
  checkHeaders(body.headers, served)
}

// A shell whose holes need the edge's nonce.
const NONCE = 'k3Vb9QmX2rT7wLp0Zc4nHg=='
const noncePaths = nonceShells.flatMap((p) => (p.includes('[') ? (samples[p] ? [samples[p]] : []) : [p]))

for (const path of noncePaths) {
  console.log(`${path} (nonce shell)`)

  check((await shellOf(path)).status === 404, 'without Edge-Accept: nonce, a 404: an edge that cannot mint one never gets it')

  const shell = await shellOf(path, { 'Edge-Token': token, 'Edge-Accept': 'nonce' })

  if (shell.status !== 200) {
    fail(`with Edge-Accept: nonce, shell is ${shell.status}, not 200`)
    continue
  }

  const body = await shell.json()
  const placeholder = body.nonce
  check(placeholder === '{edge-nonce}', 'shell names its nonce: always the literal {edge-nonce}')
  check(!body.complete, 'and is not complete')
  const isPolicy = (n) => /^content-security-policy(-report-only)?$/i.test(n)
  const policyNames = Object.keys(body.headers ?? {}).filter(isPolicy)
  const policyName = policyNames[0]
  const policy = policyName ? body.headers[policyName] : ''
  check(policyNames.length > 0 && policyNames.every((n) => body.headers[n].includes(`'nonce-${placeholder}'`)), 'its policy names the placeholder as a nonce source')
  check(
    !body.html.includes(placeholder) &&
      !body.state.includes(placeholder) &&
      Object.entries(body.headers ?? {}).every(([n, v]) => isPolicy(n) || !v.includes(placeholder)),
    'the placeholder is in the policy headers and nowhere else',
  )
  check(!/<script\b[^>]*\snonce=/i.test(body.html), 'and the cached shell carries no nonce')

  const etag = shell.headers.get('ETag')
  check(
    (await shellOf(path, { 'Edge-Token': token, 'If-None-Match': etag ?? '"x"' })).status === 404,
    'a re-check without Edge-Accept: nonce is a 404, never a 304',
  )
  if (etag) check((await shellOf(path, { 'Edge-Token': token, 'Edge-Accept': 'nonce', 'If-None-Match': etag })).status === 304, 'If-None-Match with Edge-Accept: nonce is a 304')
  check((await shellOf(path, { 'Edge-Token': token, 'Edge-Accept': 'gzip, NONCE' })).status === 200, 'Edge-Accept is a list, matched without regard to case')

  check((await resumeOf(path, body.state)).status === 400, 'a resume without Edge-Nonce is a 400, refused before it renders')
  for (const [what, bad] of [['shorter than 128 bits', 'k3Vb9QmX2rT7wLp0Zc4n'], ['longer than 128 characters', 'A'.repeat(129)], ['not base64', 'k3Vb9QmX2rT7wLp0Zc4nHg!!']]) {
    check((await resumeOf(path, body.state, { 'Edge-Token': token, 'Edge-Nonce': bad })).status === 400, `a resume with a nonce ${what} is a 400`)
  }

  const resumed = await resumeOf(path, body.state, { 'Edge-Token': token, 'Edge-Nonce': NONCE })
  const holes = await resumed.text()
  check(resumed.status === 200 && unstored(resumed), 'a resume with Edge-Nonce is a 200, private, no-store')
  const scripts = (holes.match(/<script\b[^>]*>/gi) ?? []).filter((tag) => !/\ssrc=|type="application\/json"/i.test(tag))
  check(scripts.every((tag) => tag.includes(`nonce="${NONCE}"`)), `every inline script in the holes carries the edge's nonce (${scripts.length})`)

  const served = await fetch(`${base}${encodeURI(path)}`, { headers: { Accept: 'text/html' } })
  await served.arrayBuffer()
  const direct = (served.headers.get(policyName ?? 'content-security-policy') ?? '').replace(/'nonce-[^']+'/g, `'nonce-${placeholder}'`)
  check(direct === policy, 'and the policy is the page served directly, its nonce aside')
}

// A resume for a path with no shell is a 404 with or without a nonce: a 400
// only ever answers a nonce shell, so an edge can read one as its own bug.
if (nonceShells.length) {
  for (const path of [...statics.slice(0, 1), '/__edge-conformance/no-such-page']) {
    check((await resumeOf(path, '')).status === 404, `a resume for ${path}, which has no shell, is a 404 without a nonce`)
  }
}

// A static page: whole, the page itself, and able to boot from the edge
// alone - everything its document links is an immutable asset, so nothing it
// needs is a request the edge passes to the app.
for (const path of statics) {
  console.log(`${path} (static)`)

  const answer = await shellOf(path)

  if (answer.status !== 200) {
    fail(`page is ${answer.status}, not 200`)
    continue
  }

  check(answer.headers.get('Edge-Build') === marker.build, 'page says the marker\'s build')
  check(unstored(answer), 'page is Cache-Control: private, no-store')
  const body = await answer.json()
  check(body.v === 2 && body.build === marker.build && body.complete === true && body.state === '', 'page is { v, build, html, state: "", complete: true }')
  check(/^\s*<!DOCTYPE html>/i.test(body.html) && /<\/html>\s*$/i.test(body.html), 'html is a whole document')
  check(!('nonce' in body), 'and names no nonce')

  // A static page can change while the build stands too (an on-demand
  // revalidation), and then it says so with an ETag.
  const etag = answer.headers.get('ETag')
  if (etag) check((await shellOf(path, { 'Edge-Token': token, 'If-None-Match': etag })).status === 304, 'If-None-Match is a 304')

  const direct = await fetch(`${base}${encodeURI(path)}`, { headers: { Accept: 'text/html' } })
  check(direct.status === 200 && (await direct.text()) === body.html, 'and it is the page served directly, byte for byte')
  checkHeaders(body.headers, direct)

  // What it needs to become interactive: scripts, styles and anything it
  // preloads (rsc-kit's stored payload is one). An icon or a manifest is not.
  const tags = body.html.match(/<(?:script|link)\b[^>]*>/gi) ?? []
  const linked = tags
    .filter((tag) => /^<script/i.test(tag) || /\srel="(?:stylesheet|modulepreload|preload)"/i.test(tag))
    .map((tag) => tag.match(/\s(?:src|href)="([^"]+)"/i)?.[1])
    .filter(Boolean)
    .map((href) => href.replace(/&amp;/g, '&'))
    .filter((href) => href.startsWith('/') && !href.startsWith('//'))
  const mutable = []

  for (const href of new Set(linked)) {
    const asset = await fetch(`${base}${href}`)
    await asset.arrayBuffer()
    if (asset.status !== 200 || !/immutable/.test(asset.headers.get('Cache-Control') ?? '')) mutable.push(`${href} (${asset.status})`)
  }

  check(mutable.length === 0, `every script, style and preload it links is an immutable asset${mutable.length ? `: not ${mutable.join(', ')}` : ''}`)
}

for (const url of flags.query) {
  console.log(url)

  const { pathname, searchParams } = new URL(url, 'http://x')
  const value = [...searchParams.values()][0]
  // A nonce shell is asked for as an edge minting nonces would: without
  // Edge-Accept: nonce it is rightly a 404, and its resume needs Edge-Nonce.
  const nonce = nonceShells.some((pattern) => matches(pattern, decodeURIComponent(pathname)))
  const page = await shellOf(decodeURIComponent(pathname), nonce ? { 'Edge-Token': token, 'Edge-Accept': 'nonce' } : undefined)

  if (page.status !== 200) {
    fail(`${pathname}'s shell is ${page.status}, not 200`)
    continue
  }

  const { state } = await page.json()
  const holes = await (await resumeOf(url, state, nonce ? { 'Edge-Token': token, 'Edge-Nonce': NONCE } : undefined)).text()

  check(Boolean(value) && holes.includes(value), `the holes were rendered for the visitor's query (${value})`)
}

console.log('refusals')
const first = paths[0] ?? '/'
const refused = await shellOf(first, {})
check(refused.status === 404, 'a page without Edge-Token is a 404')
check(unstored(refused), 'and the 404 is Cache-Control: private, no-store too')
check((await shellOf(first, { 'Edge-Token': `${token}x` })).status === 404, 'a page with a wrong Edge-Token is a 404')
check((await resumeOf(first, '', {})).status === 404, 'a resume without Edge-Token is a 404')
const unknown = await fetch(`${base}/_edge/nothing?path=${encodeURIComponent(first)}`, { headers: { 'Edge-Token': token } })
check(unknown.status === 404, 'any other path under /_edge/, with the token, is a 404')
check(unstored(unknown), 'and private, no-store too')
// A static page is whole: it has no holes, so nothing to resume.
if (statics[0]) check((await resumeOf(statics[0], '')).status === 404, `a resume for static ${statics[0]} is a 404`)
for (const path of flags.unlisted) check((await shellOf(path)).status === 404, `unlisted ${path} is a 404`)
for (const path of flags.guarded) {
  check(
    !statics.includes(path) && ![...marker.shells, ...nonceShells].some((pattern) => matches(pattern, path)),
    `guarded ${path} is in no list`,
  )
  check((await shellOf(path)).status === 404, `guarded ${path} is a 404`)
}

console.log(failed ? `\n${failed} failed` : '\nconforms')
process.exit(failed ? 1 : 0)
