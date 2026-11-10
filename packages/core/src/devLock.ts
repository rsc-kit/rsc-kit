/**
 * One dev server per app.
 *
 * Two `vite dev` processes in one project share everything that makes dev
 * work: Vite's pre-bundle cache, rsc-host.json and the hot file the backend
 * finds the renderer by. Each re-bundles the cache under the other, which
 * answers its next request with ERR_OUTDATED_OPTIMIZED_DEP; each writes the
 * hot file, and the one stopped first deletes it from under the one still
 * running, so the backend reports no renderer at all. Nothing pointed at the
 * cause. It happens easily: `artisan dev` started by an editor or Herd, and
 * `bun run dev` in a terminal.
 *
 * So the first dev server holds a lock in Vite's cache directory - the thing
 * they share - and a second one refuses to start, naming the first.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK = "rsc-kit-dev.json";

export interface DevServerHolder {
  pid: number;
  url?: string;
}

const lockPath = (cacheDir: string) => join(cacheDir, LOCK);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // EPERM: it exists, and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function read(cacheDir: string): DevServerHolder | null {
  try {
    const held = JSON.parse(readFileSync(lockPath(cacheDir), "utf-8")) as DevServerHolder;

    return Number.isInteger(held?.pid) ? held : null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock for this process, or returns the dev server that holds it.
 * A lock left by a process that is gone - killed, crashed - is taken over.
 * This process's own (a restart) is kept.
 */
export function claimDevServer(cacheDir: string, pid = process.pid): DevServerHolder | null {
  const held = read(cacheDir);

  if (held && held.pid !== pid && alive(held.pid)) return held;

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(lockPath(cacheDir), JSON.stringify({ pid }));

  return null;
}

/** Records where this server listens, for the message a second one prints. */
export function recordDevServerUrl(cacheDir: string, url: string, pid = process.pid): void {
  if (read(cacheDir)?.pid !== pid) return;

  writeFileSync(lockPath(cacheDir), JSON.stringify({ pid, url }));
}

/** Lets go of the lock, if this process holds it. */
export function releaseDevServer(cacheDir: string, pid = process.pid): void {
  if (read(cacheDir)?.pid !== pid) return;

  try {
    rmSync(lockPath(cacheDir));
  } catch {}
}

export function secondDevServerMessage(root: string, held: DevServerHolder): string {
  return (
    `[rsc-kit] Another dev server is already running for ${root} ` +
    `(pid ${held.pid}${held.url ? `, ${held.url}` : ""}). ` +
    "Two would share one pre-bundle cache and one hot file, and break each other: " +
    "stale pre-bundles (ERR_OUTDATED_OPTIMIZED_DEP), and a backend that loses the renderer when either stops. " +
    "Stop that one, or use it - an editor or `artisan dev` may have started it for you."
  );
}
