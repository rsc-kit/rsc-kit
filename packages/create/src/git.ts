import { spawnSync } from 'node:child_process'

/** Whether `dir` is already inside a git work tree - its own, or a parent's. */
export function insideRepository(dir: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, stdio: 'pipe' })

  return result.status === 0 && String(result.stdout).trim() === 'true'
}
