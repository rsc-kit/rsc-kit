// The rsc-kit section of AGENTS.md: written stamped, brought up to date in
// place, never touching what is around it, and never guessing what it was
// written for.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentsFlags, agentsSection, readStamp, rules, updateAgents } from '../src/agents'

const dirs: string[] = []
const project = (agents?: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'rsc-agents-'))

  dirs.push(dir)
  if (agents !== undefined) writeFileSync(join(dir, 'AGENTS.md'), agents)

  return dir
}
const read = (dir: string) => readFileSync(join(dir, 'AGENTS.md'), 'utf-8')
const BUN = { host: 'bun' as const, sourceDir: 'src', env: true, pwa: false }

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the rules', () => {
  test('say the things an agent most often gets wrong, up front', () => {
    const text = rules(BUN)
    const top = text.slice(0, text.indexOf('## Commands'))

    for (const rule of ['not done without its test', 'env.ts', '<Suspense>', 'refreshOn', 'usePolling', 'generated files', 'Secrets are generated', 'how_to']) {
      expect(top).toContain(rule)
    }
  })

  test('a Laravel app is not told about env.ts and createTestApp: its config and tests are Laravel\'s', () => {
    const top = rules({ ...BUN, host: 'laravel' }).split('## Commands')[0]!

    expect(top).not.toContain('env.ts')
    expect(top).toContain('Pest')
  })
})

describe('the section', () => {
  test('is stamped with the version that wrote it and the options it was written for', () => {
    const stamp = readStamp(agentsSection(BUN))

    expect(stamp).toMatchObject({ host: 'bun', sourceDir: 'src', env: true, pwa: false })
    expect(typeof stamp?.version).toBe('string')
  })

  test('is brought up to date in place, and nothing around it changes', () => {
    const old = agentsSection(BUN).replace(/"version":"[^"]*"/, '"version":"0.0.1"').replace('## Rules', '## Old rules')
    const dir = project(`# Our team's rules\n\nUse tabs.\n\n${old}\n## After us\n\nKeep this.\n`)

    expect(updateAgents(dir).kind).toBe('updated')

    const text = read(dir)

    expect(text.startsWith("# Our team's rules\n\nUse tabs.\n\n")).toBe(true)
    expect(text).toContain('## After us\n\nKeep this.')
    expect(text).toContain('## Rules')
    expect(text).not.toContain('## Old rules')
    expect(readStamp(text)?.version).not.toBe('0.0.1')
    expect(updateAgents(dir).kind).toBe('current')
  })

  test('an older section with no stamp is not guessed at: it asks for the host and source directory', () => {
    const dir = project('<!-- rsc-kit:start -->\nold rules\n<!-- rsc-kit:end -->\n')
    const refused = updateAgents(dir)

    expect(refused.kind).toBe('refused')
    expect(refused.kind === 'refused' && refused.reason).toContain('--host')
    expect(updateAgents(dir, { host: 'node', sourceDir: 'app' }).kind).toBe('updated')
    expect(readStamp(read(dir))).toMatchObject({ host: 'node', sourceDir: 'app' })
  })

  test('a file with no section is only rewritten whole when asked', () => {
    const dir = project('# Working in this project\n\nwritten by an older rsc-kit, unmarked\n')

    expect(updateAgents(dir, { host: 'bun', sourceDir: 'src' }).kind).toBe('refused')
    expect(read(dir)).toContain('unmarked')
    expect(updateAgents(dir, { host: 'bun', sourceDir: 'src', replace: true }).kind).toBe('wrote')
    expect(readStamp(read(dir))).toMatchObject({ host: 'bun' })
  })

  test('no AGENTS.md at all: written, given what it is for', () => {
    const dir = project()

    expect(updateAgents(dir, { host: 'worker', sourceDir: 'src' }).kind).toBe('wrote')
    expect(read(dir)).toContain('## Rules')
  })
})

describe('flags', () => {
  test('read both spellings', () => {
    expect(agentsFlags(['--host', 'laravel', '--source-dir=resources/js', '--env', '--replace'])).toEqual({
      host: 'laravel',
      sourceDir: 'resources/js',
      env: true,
      replace: true,
    })
  })
})

describe('authorisation, by who owns the actions', () => {
  test('an app whose actions are its own JavaScript builds them from the action client', () => {
    const top = rules(BUN).split('## Commands')[0]!

    expect(top).toContain('src/server/client.ts')
    expect(top).toContain('.use()')
  })

  test('an app with a Go or other backend authorises there', () => {
    const top = rules({ ...BUN, backend: true }).split('## Commands')[0]!

    expect(top).toContain('lives in the backend')
    expect(top).not.toContain('server/client.ts')
  })

  test('a Laravel app names its attributes', () => {
    expect(rules({ ...BUN, host: 'laravel' }).split('## Commands')[0]).toContain('#[Authenticated]')
  })
})

describe('the scaffold', () => {
  const CREATE = join(import.meta.dir, '../src/index.ts')
  const scaffold = (...flags: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'rsc-scaffold-'))

    dirs.push(dir)
    const run = Bun.spawnSync(['bun', CREATE, 'app', '--yes', '--host=bun', '--no-install', '--no-git', ...flags], { cwd: dir })

    if (run.exitCode !== 0) throw new Error(run.stderr.toString())

    return join(dir, 'app')
  }

  test('writes the action client for an app whose actions are its own, and stamps the section', () => {
    const app = scaffold()
    const client = readFileSync(join(app, 'src/server/client.ts'), 'utf-8')

    expect(client).toContain('export const authedClient = publicClient.use(')
    expect(readStamp(readFileSync(join(app, 'AGENTS.md'), 'utf-8'))).toMatchObject({ host: 'bun', backend: false })
  })

  test('writes none for an app with a backend: its actions are the backend\'s', () => {
    const app = scaffold('--backend=http://127.0.0.1:8080')

    expect(() => readFileSync(join(app, 'src/server/client.ts'), 'utf-8')).toThrow()
    expect(readStamp(readFileSync(join(app, 'AGENTS.md'), 'utf-8'))).toMatchObject({ backend: true })
  })
})

describe('the CLI and the MCP server', () => {
  test('are installed at the engine version, so bunx runs the copy that matches the app', () => {
    const app = (() => {
      const dir = mkdtempSync(join(tmpdir(), 'rsc-pin-'))

      dirs.push(dir)
      const run = Bun.spawnSync(['bun', join(import.meta.dir, '../src/index.ts'), 'app', '--yes', '--host=bun', '--no-install', '--no-git', '--core=^0.29.6'], { cwd: dir })

      if (run.exitCode !== 0) throw new Error(run.stderr.toString())

      return join(dir, 'app')
    })()
    const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf-8'))

    expect(pkg.devDependencies['rsc-kit']).toBe('^0.29.6')
    expect(pkg.devDependencies['@rsc-kit/mcp']).toBe('^0.29.6')
  })

  test('follow a local checkout to its sibling packages', async () => {
    const { sibling } = await import('../src/templates')

    expect(sibling('file:/repo/packages/core', 'cli')).toBe('file:/repo/packages/cli')
    expect(sibling('file:../rsc-kit/packages/core/', 'mcp')).toBe('file:../rsc-kit/packages/mcp')
    expect(sibling('^0.29.6', 'mcp')).toBe('^0.29.6')
  })
})
