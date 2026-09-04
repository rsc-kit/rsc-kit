import { chmodSync, unlinkSync } from "node:fs";
import { listen, runtimeName, scanScripts, yieldToEventLoop, type SocketLike } from "./runtime.ts";
import { createDeferredHost, streamWithDeferredRelease, type DeferredHost } from "./streaming.ts";
import { join, resolve } from "node:path";
import { ServerAuthenticationError, ServerAuthorizationError, ServerRedirectError, ServerValidationError } from "./errors.ts";

type MessageHandler = (args: Record<string, unknown>) => unknown;

const functions: Record<string, MessageHandler> = {};

interface LayoutEntry {
  component: string;
  props: Record<string, unknown>;
}

interface SlotOverride {
  component: string;
  props: Record<string, unknown>;
}

interface IncomingMessage {
  type: "ping" | "call" | "list" | "rsc" | "rsc-stream" | "rsc-html-stream" | "rsc-action" | "rsc-ppr-shell" | "rsc-payload";
  /** Which part to render on its own: all, page, or a slot name. */
  target?: string;
  function?: string;
  args?: Record<string, unknown>;
  page?: Record<string, unknown>;
  component?: string;
  props?: Record<string, unknown>;
  layouts?: LayoutEntry[];
  loadings?: string[];
  parallelSlots?: Record<string, string>;
  slotOverrides?: Record<string, SlotOverride> | null;
  callbackSocket?: string; // deprecated — use callbackId
  callbackId?: string;
  /** How many layouts the client already has mounted; the render starts there. */
  from?: number;
  /** Identifies the page, so boundaries can retain it for a later return. */
  pageKey?: string;
  /** False ships the page as HTML only — no React, no router. */
  bootstrap?: boolean;
  nonce?: string;
  actionId?: string;
  /**
   * Bytes when the body arrived on its own frame, which is how an upload
   * travels — frames carry bytes, so nothing has to be encoded to fit.
   */
  body?: string | Uint8Array;
  /** "binary" means the body is the frame after this one. */
  bodyEncoding?: string;
  /** What renders the page an action came from, so what it invalidates can be re-rendered. */
  page?: {
    component: string;
    props: Record<string, unknown>;
    layouts: LayoutEntry[];
    loadings: string[];
    parallelSlots: Record<string, string>;
  };
  bodyLength?: number;
  contentType?: string;
}

function log(...args: unknown[]): void {
  console.error(`[rsc-worker:${runtimeName}]`, ...args);
}

async function discoverFunctions(dir: string): Promise<void> {
  const scripts = scanScripts(dir);

  for (const path of scripts) {
    const mod = await import(join(dir, path));

    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== "function") continue;

      if (name in functions) {
        log(`Warning: duplicate function "${name}" from ${path}, skipping`);
        continue;
      }

      functions[name] = fn as MessageHandler;
    }
  }
}

async function loadEntryPoints(): Promise<void> {
  const raw = process.env.RSC_ENTRY_POINTS ?? "";
  const paths = raw.split(",").map((p) => p.trim()).filter(Boolean);

  for (const entryPath of paths) {
    const absolute = resolve(entryPath);

    try {
      const mod = await import(absolute);

      for (const [name, fn] of Object.entries(mod)) {
        if (name === "default" || typeof fn !== "function" || name.length <= 2) continue;

        if (name in functions) {
          log(`Warning: duplicate function "${name}" from ${entryPath}, skipping`);
          continue;
        }

        functions[name] = fn as MessageHandler;
      }

      if (typeof mod.default === "function" && !("default" in functions)) {
        const baseName = absolute.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "default";
        const fnName = baseName in functions ? "default" : baseName;

        if (fnName in functions) {
          log(`Warning: duplicate function "${fnName}" from ${entryPath}, skipping`);
        } else {
          functions[fnName] = mod.default as MessageHandler;
        }
      }
    } catch (err) {
      log(`Failed to load entry point "${entryPath}":`, err instanceof Error ? err.message : String(err));
    }
  }
}

async function handleMessage(message: IncomingMessage): Promise<string> {
  switch (message.type) {
    case "ping":
      return '{"type":"pong"}';

    case "call": {
      const fn = functions[message.function ?? ""];
      if (!fn) {
        return JSON.stringify({
          error: `Function "${message.function}" not found. Available: ${Object.keys(functions).join(", ")}`,
        });
      }
      try {
        const result = await fn(message.args ?? {});
        return JSON.stringify({ result });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    case "rsc-payload": {
      if (!rscHandler) {
        return '{"error":"RSC not enabled."}';
      }
      if (!message.component) {
        return '{"error":"Missing component in RSC message"}';
      }
      try {
        const result = await rscHandler.handleRscPayload(
          message.component,
          message.props ?? {},
          message.layouts ?? [], message.loadings ?? [], message.parallelSlots ?? {},
          message.from ?? 0,
          message.pageKey ?? ""
        );

        return JSON.stringify({ result });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    case "rsc": {
      if (!rscHandler) {
        return '{"error":"RSC not enabled. Set RSC_ENABLED=true and run: bun run build:rsc"}';
      }
      if (!message.component) {
        return '{"error":"Missing component in RSC message"}';
      }
      try {
        // Install the host callable if a callback connection is available
        let cleanupPhp: (() => void) | null = null;
        if (message.callbackId) {
          const cbConn = await getCallbackConnection(message.callbackId);
          cleanupPhp = rscHandler.installHostFn(createPhpFn(cbConn));
        }

        try {
          // A target asks for one part of this page rather than the whole of
          // it, and needs the same host connection a page does.
          if (message.target) {
            const result = await rscHandler.handleRscRevalidate(message.target, {
              component: message.component,
              props: message.props ?? {},
              layouts: message.layouts ?? [],
              loadings: message.loadings ?? [],
              parallelSlots: message.parallelSlots ?? {},
            });

            return JSON.stringify({ result });
          }

          const metadata = await rscHandler.resolveMetadata(
            message.component,
            message.props ?? {},
            message.layouts ?? [],
          );
          const result = await rscHandler.handleRsc(
            message.component,
            message.props ?? {},
            message.callbackSocket ?? null, // fallback for old protocol
            message.layouts ?? [], message.loadings ?? [], message.parallelSlots ?? {},
            message.from ?? 0,
            message.pageKey ?? "",
            message.bootstrap !== false
          );
          return JSON.stringify({ result: { ...result, metadata } });
        } finally {
          cleanupPhp?.();
          if (message.callbackId) callbackConnections.delete(message.callbackId);
        }
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    case "rsc-ppr-shell": {
      if (!rscHandler) {
        return '{"error":"RSC not enabled. Set RSC_ENABLED=true and run: bun run build:rsc"}';
      }
      if (!message.component) {
        return '{"error":"Missing component in RSC message"}';
      }
      try {
        const result = await rscHandler.handleRscPprShell(
          message.component,
          message.props ?? {},
          message.layouts ?? [], message.loadings ?? [], message.parallelSlots ?? {}
        );
        return JSON.stringify({ result });
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    case "list":
      return JSON.stringify({ result: Object.keys(functions) });

    default:
      return JSON.stringify({ error: `Unknown message type: "${message.type}"` });
  }
}

const functionsDir = process.env.RSC_FUNCTIONS_DIR;
const socketPath = process.env.RSC_SOCKET ?? "/tmp/bun-bridge.sock";

// Transport: 'unix' (default) listens on socketPath; 'tcp' listens on
// RSC_HOST:RSC_MAIN_PORT (main) and RSC_HOST:RSC_CB_PORT (callbacks).
const isTcp = process.env.RSC_TRANSPORT === "tcp";
const tcpHost = process.env.RSC_HOST ?? "127.0.0.1";
const mainPort = parseInt(process.env.RSC_MAIN_PORT ?? "0", 10);
const cbPort = parseInt(process.env.RSC_CB_PORT ?? "0", 10);

if (functionsDir) {
  await discoverFunctions(functionsDir);
}

await loadEntryPoints();

// Load RSC handler if a bundle is configured
interface BrowserManifest {
  entry: string;
  shared: string[];
  modules: Record<string, string[]>;
}

type RscHandlerModule = {
  installHostFn: (hostFn: (fn: string, ...args: unknown[]) => Promise<unknown>) => () => void;
  handleRsc: (
    component: string,
    props: Record<string, unknown>,
    callbackSocket?: string | null,
    layouts?: LayoutEntry[]
  ) => Promise<{ body: string; rscPayload: string; clientChunks: BrowserManifest; usedDynamicApis: boolean }>;
  handleRscStream: (
    component: string,
    props: Record<string, unknown>,
    layouts?: LayoutEntry[]
  ) => Promise<{ stream: ReadableStream; clientChunks: BrowserManifest }>;
  handleRscHtmlStream: (
    component: string,
    props: Record<string, unknown>,
    layouts?: LayoutEntry[],
    loadings?: string[],
    parallelSlots?: Record<string, string>,
    slotOverrides?: Record<string, { component: string; props: Record<string, unknown> }>,
    nonce?: string
  ) => Promise<{ htmlStream: ReadableStream; rscPayloadPromise: Promise<string>; clientChunks: BrowserManifest }>;
  handleAction: (
    actionId: string,
    body: string | Uint8Array,
    contentType: string,
    page?: IncomingMessage["page"],
    takeRevalidated?: () => string[],
  ) => Promise<{ stream: ReadableStream }>;
  handleRscRevalidate: (
    target: string,
    page: NonNullable<IncomingMessage["page"]>,
  ) => Promise<{ rscPayload: string }>;
  handleRscPprShell: (
    component: string,
    props: Record<string, unknown>,
    layouts?: LayoutEntry[]
  ) => Promise<{ shellHtml: string; clientChunks: BrowserManifest; timedOut: boolean; usedDynamicApis: boolean }>;
  resolveMetadata: (
    component: string,
    props: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
};

let rscHandler: RscHandlerModule | null = null;

if (process.env.RSC_DEV_CONFIG) {
  // Dev mode: the entry comes from Vite's runnable rsc environment rather than
  // a bundle, so an edit is live without a rebuild. Same module contract.
  try {
    const { startDevServer, devEntryPath } = await import("./devServer.ts");
    const outDir = process.env.RSC_OUT_DIR!;

    const dev = await startDevServer({
      projectRoot: process.env.RSC_PROJECT_ROOT ?? process.cwd(),
      configFile: process.env.RSC_DEV_CONFIG,
      entry: devEntryPath(outDir),
      port: parseInt(process.env.RSC_DEV_PORT ?? "5173", 10),
    });

    rscHandler = dev.handler as unknown as RscHandlerModule;
    log(`RSC dev server on ${process.env.RSC_DEV_ORIGIN}`);
  } catch (err) {
    log(
      "Failed to start RSC dev server:",
      err instanceof Error ? err.message : String(err)
    );
  }
} else if (process.env.RSC_BUNDLE) {
  try {
    // The built @vitejs/plugin-rsc entry IS the handler — it exports the
    // installHostFn / handleRsc* / handleAction / resolveMetadata contract.
    rscHandler = (await import(process.env.RSC_BUNDLE)) as RscHandlerModule;
    log("RSC handler loaded");
  } catch (err) {
    log(
      "Failed to load RSC handler:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

if (Object.keys(functions).length === 0 && !rscHandler) {
  log("No functions discovered. Provide a functions directory or entry points.");
  process.exit(1);
}

/**
 * Handles rsc-stream messages.
 *
 * Writes Flight data frames back on the main listener's socket (same path as
 * SSR responses). The listener's drain handler handles
 * backpressure for large payloads. Runs via setTimeout so writes are not
 * corked by the data handler's async callback buffering.
 */
async function handleRscStreamMessage(
  mainSocket: SocketLike,
  message: IncomingMessage
): Promise<void> {
  if (!rscHandler) {
    writeFrame(mainSocket, '{"error":"RSC not enabled"}');
    return;
  }
  if (!message.component) {
    writeFrame(mainSocket, '{"error":"Missing component in RSC message"}');
    return;
  }

  let cleanupPhp: (() => void) | null = null;
  try {
    let deferred: DeferredHost | null = null;

    if (message.callbackId) {
      const cbConn = await getCallbackConnection(message.callbackId);
      deferred = createDeferredHost(createPhpFn(cbConn));
      cleanupPhp = rscHandler.installHostFn(deferred.hostFn);
    }

    const metadata = await rscHandler.resolveMetadata(
      message.component,
      message.props ?? {},
      message.layouts ?? [],
    );

    deferred?.begin();

    const { stream, clientChunks, segmentDepth } = await rscHandler.handleRscStream(
      message.component,
      message.props ?? {},
      message.layouts ?? [], message.loadings ?? [], message.parallelSlots ?? {},
      message.slotOverrides ?? undefined,
      message.from ?? 0,
      message.pageKey ?? ""
    );

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    const writeStreamChunk = (value: string | Uint8Array): void => {
      const text = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      writeFrame(mainSocket, JSON.stringify({ type: "stream-chunk", data: text }));
    };

    writeFrame(mainSocket, JSON.stringify({ type: "stream-start", clientChunks, metadata, segmentDepth }));

    // Flight's root model and the rows for each Suspense fallback go out before
    // any host call is released; see streamWithDeferredRelease.
    await streamWithDeferredRelease(reader, writeStreamChunk, () => deferred?.flush());

    writeFrame(mainSocket, '{"type":"stream-end"}');
  } catch (err) {
    const errorJson = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    try {
      writeFrame(mainSocket, errorJson);
    } catch {
      // Best effort
    }
  } finally {
    cleanupPhp?.();
    if (message.callbackId) callbackConnections.delete(message.callbackId);
  }
}

/**
 * Handles rsc-html-stream messages for initial page loads with Suspense.
 *
 * Writes HTML + Flight payload frames back on the main listener's socket
 * (same path as SSR responses). The drain handler
 * handles backpressure for large payloads.
 */
async function handleRscHtmlStreamMessage(
  mainSocket: SocketLike,
  message: IncomingMessage
): Promise<void> {
  if (!rscHandler) {
    writeFrame(mainSocket, '{"error":"RSC not enabled"}');
    return;
  }
  if (!message.component) {
    writeFrame(mainSocket, '{"error":"Missing component in RSC message"}');
    return;
  }

  let cleanupPhp: (() => void) | null = null;
  try {
    let deferred: DeferredHost | null = null;

    if (message.callbackId) {
      const cbConn = await getCallbackConnection(message.callbackId);
      deferred = createDeferredHost(createPhpFn(cbConn));
      cleanupPhp = rscHandler.installHostFn(deferred.hostFn);
    }

    const metadata = await rscHandler.resolveMetadata(
      message.component,
      message.props ?? {},
      message.layouts ?? [],
    );

    deferred?.begin();

    const { htmlStream, rscPayloadPromise, clientChunks } =
      await rscHandler.handleRscHtmlStream(
        message.component,
        message.props ?? {},
        message.layouts ?? [], message.loadings ?? [], message.parallelSlots ?? {},
        message.slotOverrides ?? undefined,
        message.nonce ?? undefined,
        message.pageKey ?? ""
      );

    const reader = htmlStream.getReader();
    const decoder = new TextDecoder();

    const writeHtmlChunk = (value: string | Uint8Array): void => {
      const text = typeof value === "string" ? value : decoder.decode(value, { stream: true });
      writeFrame(mainSocket, JSON.stringify({ type: "html-chunk", data: text }));
    };

    // Write html-start and the shell without yielding the event loop
    writeFrame(mainSocket, JSON.stringify({ type: "html-start", clientChunks, metadata }));

    // The whole shell, with every Suspense fallback in it, goes out before any
    // host call is released; see streamWithDeferredRelease.
    await streamWithDeferredRelease(reader, writeHtmlChunk, () => deferred?.flush());

    const rscPayload = await rscPayloadPromise;
    writeFrame(mainSocket, JSON.stringify({ type: "html-end", rscPayload }));
  } catch (err) {
    const errorJson = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    try {
      writeFrame(mainSocket, errorJson);
    } catch {
      // Best effort
    }
  } finally {
    cleanupPhp?.();
    if (message.callbackId) callbackConnections.delete(message.callbackId);
  }
}

/**
 * Handles rsc-action messages (server action calls).
 *
 * Same streaming pattern as handleRscStreamMessage — writes Flight
 * data frames back on the main socket with action-specific frame types.
 */
async function handleRscActionMessage(
  mainSocket: SocketLike,
  message: IncomingMessage
): Promise<void> {
  if (!rscHandler) {
    writeFrame(mainSocket, '{"error":"RSC not enabled"}');
    return;
  }
  if (!message.actionId) {
    writeFrame(mainSocket, '{"error":"Missing actionId in rsc-action message"}');
    return;
  }

  let cleanupPhp: (() => void) | null = null;
  // Held beyond the block below: what the host marks stale during the action
  // is collected against this connection and read after the action returns.
  let cbConn: SocketLike | null = null;

  try {
    if (message.callbackId) {
      cbConn = await getCallbackConnection(message.callbackId);
      cleanupPhp = rscHandler.installHostFn(createPhpFn(cbConn));
    }

    // Already bytes when a body arrived on its own frame; there is nothing to
    // decode and nothing to reinterpret.
    const actionBody = message.body ?? "";

    const { stream } = await rscHandler.handleAction(
      message.actionId,
      actionBody,
      message.contentType ?? "text/plain",
      // The page the action was invoked from, resolved by the host — the
      // browser knows the url but not which components render it.
      message.page,
      () => takeRevalidated(cbConn),
    );

    writeFrame(mainSocket, '{"type":"action-start"}');
    await yieldToEventLoop();

    const reader = stream.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = typeof value === "string"
        ? value
        : decoder.decode(value, { stream: true });
      writeFrame(mainSocket, JSON.stringify({ type: "action-chunk", data: text }));
      await yieldToEventLoop();
    }

    // What the host marked stale while the action ran. Reported on the way
    // out so the answer can carry it; the parts themselves follow once the
    // worker is given the page context to render them against.
    const revalidated = takeRevalidated(cbConn);

    writeFrame(
      mainSocket,
      JSON.stringify(revalidated.length > 0 ? { type: "action-end", revalidated } : { type: "action-end" }),
    );
  } catch (err) {
    let errorJson: string;
    if (err instanceof ServerAuthenticationError) {
      errorJson = JSON.stringify({
        unauthenticated: true,
        error: err.message,
      });
    } else if (err instanceof ServerAuthorizationError) {
      errorJson = JSON.stringify({
        unauthorized: true,
        error: err.message,
      });
    } else if (err instanceof ServerRedirectError) {
      errorJson = JSON.stringify({
        redirect: err.location,
      });
    } else if (err instanceof ServerValidationError) {
      errorJson = JSON.stringify({
        error: err.message,
        validation_errors: err.errors,
      });
    } else {
      errorJson = JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      writeFrame(mainSocket, errorJson);
    } catch {
      // Best effort
    }
  } finally {
    cleanupPhp?.();
    if (message.callbackId) callbackConnections.delete(message.callbackId);
  }
}

if (!isTcp) {
  try {
    unlinkSync(socketPath);
  } catch {
    // File doesn't exist
  }
}

const pendingWriteBuffers = new Map<unknown, Buffer>();
const socketBuffers = new Map<unknown, Buffer>();

function drainSocket(socket: SocketLike): void {
  const pending = pendingWriteBuffers.get(socket);
  if (!pending) return;

  const written = socket.write(pending);
  if (written < pending.length) {
    pendingWriteBuffers.set(socket, pending.subarray(written));
  } else {
    pendingWriteBuffers.delete(socket);
  }
}

function writeFrame(socket: SocketLike, json: string): void {
  const payload = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);

  const frame = Buffer.concat([header, payload]);

  // If there are pending writes from a previous partial write,
  // queue this frame behind them to maintain frame ordering.
  // Writing directly would interleave with pending data on the wire.
  const existing = pendingWriteBuffers.get(socket);
  if (existing) {
    pendingWriteBuffers.set(socket, Buffer.concat([existing, frame]));
    return;
  }

  const written = socket.write(frame);
  if (written < frame.length) {
    pendingWriteBuffers.set(socket, frame.subarray(written));
  }
}

const MAX_FRAME_SIZE = parseInt(process.env.RSC_MAX_FRAME_SIZE || "1048576", 10); // 1MB default

/**
 * Messages whose body is arriving as the next frame.
 *
 * An upload body is bytes, and frames are bytes, so it travels as its own
 * frame instead of being encoded to fit inside the JSON one. The frame after
 * such a header is that body and must not be parsed as JSON.
 */
const pendingBody = new Map<SocketLike, IncomingMessage>();

/**
 * What the host marked stale while an action was running, per callback
 * connection.
 *
 * An action knows what it changed and the page does not, so the marks ride
 * back with each callback's result. Collected here so the answer to the action
 * can carry the re-rendered parts — rather than telling the browser what went
 * stale and waiting for it to ask.
 */
const revalidations = new Map<SocketLike, Set<string>>();

function markRevalidated(socket: SocketLike, targets: string[]): void {
  const marked = revalidations.get(socket) ?? new Set<string>();

  for (const target of targets) marked.add(target);

  revalidations.set(socket, marked);
}

/** Take what a connection collected and forget it. */
function takeRevalidated(socket: SocketLike | null): string[] {
  if (!socket) return [];

  const marked = revalidations.get(socket);
  revalidations.delete(socket);

  return marked ? [...marked] : [];
}

// Create the socket files owner-only. Without this, any local user could
// connect to the predictable socket path and drive the bridge (invoke server
// actions / php() callables) with no authenticated session. PHP-FPM must run
// as the same user as this worker (already implied by sharing the socket).
try { process.umask(0o077); } catch {}

/** Restrict a bound Unix socket to owner read/write only. */
function secureSocket(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch (err) {
    log("Failed to secure socket permissions:", err instanceof Error ? err.message : String(err));
  }
}

const server = listen(
  isTcp ? { hostname: tcpHost, port: mainPort } : { unix: socketPath },
  {
    async data(socket, rawData) {
      let buf = socketBuffers.get(socket);
      buf = buf ? Buffer.concat([buf, Buffer.from(rawData)]) : Buffer.from(rawData);

      while (buf.length >= 4) {
        const frameLength = buf.readUInt32BE(0);

        if (frameLength <= 0 || frameLength > MAX_FRAME_SIZE) {
          log("Invalid frame length:", frameLength);
          socketBuffers.delete(socket);
          return;
        }

        if (buf.length < 4 + frameLength) {
          break;
        }

        const payload = buf.subarray(4, 4 + frameLength);
        buf = buf.subarray(4 + frameLength);

        const awaiting = pendingBody.get(socket);

        if (awaiting) {
          pendingBody.delete(socket);
          // Copied because the read buffer is reused for the frames after it.
          awaiting.body = Buffer.from(payload);
          setTimeout(() => handleRscActionMessage(socket, awaiting), 0);
          continue;
        }

        try {
          const message = JSON.parse(payload.toString("utf-8")) as IncomingMessage;

          if (message.bodyEncoding === "binary" && (message.bodyLength ?? 0) > 0) {
            pendingBody.set(socket, message);
            continue;
          }

          if (message.type === "rsc-stream" || message.type === "rsc-html-stream" || message.type === "rsc-action" || message.type === "rsc-ppr-shell") {
            // Run outside the data handler so socket writes are not corked
            // and setTimeout/Promise.race timeouts can fire.
            if (message.type === "rsc-ppr-shell") {
              setTimeout(async () => {
                const response = await handleMessage(message);
                writeFrame(socket, response);
              }, 0);
            } else {
              const handler = message.type === "rsc-html-stream"
                ? handleRscHtmlStreamMessage
                : message.type === "rsc-action"
                  ? handleRscActionMessage
                  : handleRscStreamMessage;
              setTimeout(() => handler(socket, message), 0);
            }
          } else {
            const response = await handleMessage(message);
            writeFrame(socket, response);
          }
        } catch (err) {
          log("Failed to parse message:", err);
          writeFrame(socket, '{"error":"Invalid JSON"}');
        }
      }

      if (buf.length > 0) {
        socketBuffers.set(socket, buf);
      } else {
        socketBuffers.delete(socket);
      }
    },
    drain(socket) {
      drainSocket(socket);
    },
    open() {},
    close(socket) {
      pendingWriteBuffers.delete(socket);
      socketBuffers.delete(socket);
    },
    error(_, err) {
      log("Socket error:", err.message);
    },
  },
);

if (!isTcp) secureSocket(socketPath);

log(`Listening on ${isTcp ? `${tcpHost}:${mainPort}` : socketPath}`);
log(`Discovered ${Object.keys(functions).length} functions: ${Object.keys(functions).join(", ")}`);

// ─── Persistent Callback Server ─────────────────────────────────────────────
// PHP connects here for php() callbacks instead of per-request temp sockets.
// Each connection registers with a callbackId that matches the render request.

const callbackSocketPath = socketPath + ".cb";
if (!isTcp) { try { unlinkSync(callbackSocketPath); } catch {} }

const callbackConnections = new Map<string, SocketLike>();
const cbSocketBuffers = new Map<unknown, Buffer>();
const pendingPhpCallbacks = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  socket: SocketLike;
}>();

function handleCbResponse(response: Record<string, unknown>): void {
  const id = response.id as string;
  const pending = pendingPhpCallbacks.get(id);
  if (!pending) return;
  pendingPhpCallbacks.delete(id);

  if (Array.isArray(response.revalidate) && response.revalidate.length > 0) {
    markRevalidated(pending.socket, response.revalidate as string[]);
  }

  if (response.unauthenticated) {
    pending.reject(new ServerAuthenticationError(response.error as string));
  } else if (response.unauthorized) {
    pending.reject(new ServerAuthorizationError(response.error as string));
  } else if (response.validation_errors) {
    pending.reject(new ServerValidationError(
      (response.error as string) ?? "Validation failed",
      response.validation_errors as Record<string, string[]>
    ));
  } else if (response.redirect) {
    pending.reject(new ServerRedirectError(response.redirect as string));
  } else if (response.error) {
    pending.reject(new Error(response.error as string));
  } else {
    pending.resolve(response.result);
  }
}

const cbServer = listen(
  isTcp ? { hostname: tcpHost, port: cbPort } : { unix: callbackSocketPath },
  {
    data(socket, rawData) {
      let buf = cbSocketBuffers.get(socket);
      buf = buf ? Buffer.concat([buf, Buffer.from(rawData)]) : Buffer.from(rawData);

      while (buf.length >= 4) {
        const frameLength = buf.readUInt32BE(0);
        if (frameLength <= 0 || frameLength > MAX_FRAME_SIZE) {
          cbSocketBuffers.delete(socket);
          return;
        }
        if (buf.length < 4 + frameLength) break;

        const json = buf.subarray(4, 4 + frameLength).toString("utf-8");
        buf = buf.subarray(4 + frameLength);

        try {
          const msg = JSON.parse(json);
          if (msg.type === "register" && msg.id) {
            callbackConnections.set(msg.id, socket);
          } else {
            handleCbResponse(msg);
          }
        } catch {}
      }

      if (buf.length > 0) {
        cbSocketBuffers.set(socket, buf);
      } else {
        cbSocketBuffers.delete(socket);
      }
    },
    open() {},
    close(socket) {
      for (const [id, s] of callbackConnections) {
        if (s === socket) callbackConnections.delete(id);
      }
      cbSocketBuffers.delete(socket);

      // Reject any php() callbacks still awaiting a response on this
      // connection. Without this the awaiting render hangs forever and the
      // pending map grows for the life of the worker (a slow whole-app leak
      // when requests are aborted or the PHP side disconnects mid-render).
      for (const [id, pending] of pendingPhpCallbacks) {
        if (pending.socket === socket) {
          pendingPhpCallbacks.delete(id);
          pending.reject(new Error("Callback connection closed before php() responded"));
        }
      }
    },
    drain(socket) { drainSocket(socket); },
    error() {},
  },
);

if (!isTcp) secureSocket(callbackSocketPath);

log(`Callback listener on ${isTcp ? `${tcpHost}:${cbPort}` : callbackSocketPath}`);

let cbIdCounter = 0;

function getCallbackConnection(id: string, timeoutMs = 3000): Promise<SocketLike> {
  const existing = callbackConnections.get(id);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const check = setInterval(() => {
      const conn = callbackConnections.get(id);
      if (conn) { clearInterval(check); clearTimeout(timer); resolve(conn); }
    }, 5);
    const timer = setTimeout(() => {
      clearInterval(check);
      reject(new Error(`Callback ${id} not registered within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

function createPhpFn(cbSocket: SocketLike): (fn: string, ...args: unknown[]) => Promise<unknown> {
  return (functionName: string, ...args: unknown[]): Promise<unknown> => {
    const id = `cb_${++cbIdCounter}`;
    writeFrame(cbSocket, JSON.stringify({ type: "callback", id, function: functionName, args }));
    return new Promise((resolve, reject) => {
      pendingPhpCallbacks.set(id, { resolve, reject, socket: cbSocket });
    });
  };
}

function shutdown(signal: string): void {
  log(`Received ${signal}, shutting down`);
  server.stop();
  cbServer.stop();
  if (!isTcp) {
    try { unlinkSync(socketPath); } catch {}
    try { unlinkSync(callbackSocketPath); } catch {}
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Prevent unhandled errors from crashing the worker process.
// These can occur during socket cleanup (e.g., callback socket closed by PHP)
// or from deferred React rendering microtasks.
process.on("uncaughtException", (err) => {
  log("Uncaught exception (worker kept alive):", err.message);
});

process.on("unhandledRejection", (reason) => {
  log("Unhandled rejection (worker kept alive):", reason instanceof Error ? reason.message : String(reason));
});
