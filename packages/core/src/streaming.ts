// Streaming coordination shared by both worker paths — initial-load HTML and
// SPA-navigation Flight.
//
// Both stream React output over a socket that PHP pumps on the same thread it
// runs host callbacks on. That single fact drives everything here: React's
// first payload has to be on the socket before a callback can block, or the
// browser sees nothing until the slowest call in the page returns.

import { yieldToEventLoop } from './runtime.js'

/**
 * Read every chunk a stream already has queued, then stop.
 *
 * A queued chunk settles its read in a microtask, so it always beats the
 * macrotask this races it against. A read that loses means the producer is
 * waiting on data rather than still writing — for React's SSR stream, the
 * moment the shell is fully out.
 *
 * The losing read is handed back rather than dropped, so the caller resumes
 * without losing a chunk.
 */
export async function drainQueuedChunks<T>(
  reader: { read(): Promise<{ done: boolean; value?: T }> },
  onChunk: (chunk: T) => void,
): Promise<{ pending: Promise<{ done: boolean; value?: T }> | null; done: boolean }> {
  let pending = reader.read()

  while (true) {
    const settled = await Promise.race([
      pending.then((result) => ({ result })),
      yieldToEventLoop().then(() => null),
    ])

    if (settled === null) return { pending, done: false }
    if (settled.result.done) return { pending: null, done: true }

    onChunk(settled.result.value as T)
    pending = reader.read()
  }
}

export interface DeferredHost {
  /** Installed in place of the real host fn for the whole request. */
  hostFn: (fn: string, ...args: unknown[]) => Promise<unknown>;
  /** Start queueing. Called once metadata is resolved. */
  begin: () => void;
  /** Release the queue. Called once React's first payload is on the socket. */
  flush: () => void;
}

/**
 * Queue host calls made during the render, so React's first payload — the HTML
 * shell, or the Flight root model and fallback rows — is on the socket before
 * PHP blocks on one.
 *
 * PHP runs a host callback synchronously on the same thread that pumps that
 * socket. Once a call starts, nothing the worker writes reaches the browser
 * until it returns, so anything React had not yet produced is stranded for the
 * duration. Both streaming paths share this: it is the difference between a
 * page painting its skeletons at once and painting nothing for the length of
 * the slowest call in it.
 */
export function createDeferredHost(realHostFn: (fn: string, ...args: unknown[]) => Promise<unknown>): DeferredHost {
  const pendingCalls: Array<{
    fn: string; args: unknown[];
    resolve: (v: unknown) => void; reject: (e: Error) => void;
  }> = [];
  let flushed = false;
  let deferring = false;
  let backstop: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (flushed) return;
    flushed = true;
    clearTimeout(backstop);
    for (const call of pendingCalls) {
      realHostFn(call.fn, ...call.args).then(call.resolve, call.reject);
    }
    pendingCalls.length = 0;
  };

  return {
    hostFn: (functionName: string, ...args: unknown[]): Promise<unknown> => {
      if (!deferring || flushed) return realHostFn(functionName, ...args);

      return new Promise((resolve, reject) => {
        pendingCalls.push({ fn: functionName, args, resolve, reject });
      });
    },

    // Deferral covers the render only. Metadata resolves before any payload
    // exists, so a host call there has nothing to strand — queueing it would
    // just stall generateMetadata until the backstop fired.
    begin: () => {
      deferring = true;

      // Backstop only, for a render that awaits a host call before it can
      // produce the payload that would release the queue. The build rejects
      // such a page unless it ships a loading.tsx, whose shell does not block,
      // so in practice the drain always gets there first. Long on purpose: it
      // must never race a cold start.
      backstop = setTimeout(flush, 5000);
    },

    flush,
  };
}

/**
 * Write a React stream out, releasing the deferred host calls at the one safe
 * moment: after everything already queued — the shell, or the Flight root model
 * and fallback rows — is on the socket, and before anything that arrives later.
 *
 * Both worker paths stream through this so the ordering cannot drift between
 * them. It already had: the HTML path released after its first chunk and the
 * Flight path never deferred at all, so a slow host call blocked PHP with most
 * of the payload still unwritten and the browser rendered nothing until the
 * call returned.
 */
export async function streamWithDeferredRelease<T>(
  reader: { read(): Promise<{ done: boolean; value?: T }> },
  onChunk: (chunk: T) => void,
  release: () => void,
  idle: () => Promise<void> = yieldToEventLoop,
): Promise<void> {
  let { pending, done } = await drainQueuedChunks(reader, onChunk)

  release()

  while (!done) {
    const result = await (pending ?? reader.read())
    pending = null

    if (result.done) break

    onChunk(result.value as T)
    await idle()
  }
}
