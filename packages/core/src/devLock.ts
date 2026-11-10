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
 * they share - and a second one waits, naming the first, and starts when it
 * stops. Waiting rather than exiting: `artisan dev` restarts a process that
 * exits, so a refusal printed itself five times and gave up, and the app was
 * left with no dev server once the first was stopped.
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

/**
 * Waits until this process holds the lock: the holder stopped, or is gone.
 * Resolves at once when the lock was free.
 */
export async function waitForDevServer(
  cacheDir: string,
  { pid = process.pid, every = 1000 }: { pid?: number; every?: number } = {},
): Promise<void> {
  while (claimDevServer(cacheDir, pid)) {
    await new Promise((resolve) => setTimeout(resolve, every));
  }
}

export function secondDevServerMessage(root: string, held: DevServerHolder): string {
  return (
    `[rsc-kit] A dev server is already running for ${root} ` +
    `(pid ${held.pid}${held.url ? `, ${held.url}` : ""}) - use that one. ` +
    "This one waits and starts when it stops: two at once would share one pre-bundle cache " +
    "and one hot file, and break each other (ERR_OUTDATED_OPTIMIZED_DEP). " +
    "An editor, Herd or `artisan dev` may have started the first for you."
  );
}
