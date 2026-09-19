/**
 * A route that streams: server-sent events from an async generator.
 *
 *     // app/api/orders/[id]/events/route.ts
 *     export const GET = events(async function* ({ params, signal }) {
 *       for await (const status of orderStatus((await params).id, { signal })) {
 *         yield { status }
 *       }
 *     })
 *
 * An ordinary route.ts, so it lives beside its pages, runs the middleware.ts
 * above it and takes the same params. What this adds is the framing - one
 * `data:` line per yield, JSON - a keepalive comment every fifteen seconds
 * so a proxy does not drop an idle stream, the headers a stream needs, and
 * an end to the generator when the browser goes away, which is what `signal`
 * is for. `useEvents` on the client reads it.
 *
 * Not a query. A query answers once and is cacheable; a stream answers for
 * as long as the tab is open and is not. A server component cannot await a
 * stream, so it has no place in the payload either.
 */

export interface EventsInput<P = Record<string, string>> {
  params: Promise<P>;
  searchParams: Promise<URLSearchParams>;
  /** Aborted when the browser disconnects. Pass it on, or check `aborted`. */
  signal: AbortSignal;
  request: Request;
}

/** A message with a name or an id, for a client that listens by name or resumes. */
export interface NamedEvent<T> {
  event?: string;
  id?: string;
  data: T;
}

/** How often a comment goes out on an idle stream, so a proxy keeps it open. */
export const KEEPALIVE_MS = 15_000;

function isNamed<T>(value: unknown): value is NamedEvent<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    ("event" in value || "id" in value) &&
    Object.keys(value).every((k) => k === "event" || k === "id" || k === "data")
  );
}

/** One message, framed. */
export function frame(value: unknown): string {
  const named = isNamed(value) ? value : null;
  const lines: string[] = [];

  if (named?.event) lines.push(`event: ${named.event}`);
  if (named?.id) lines.push(`id: ${named.id}`);
  lines.push(`data: ${JSON.stringify(named ? named.data : value)}`);

  return lines.join("\n") + "\n\n";
}

export function events<P = Record<string, string>, T = unknown>(
  produce: (input: EventsInput<P>) => AsyncIterable<T | NamedEvent<T>>,
  options: { keepaliveMs?: number } = {},
): (
  request: Request,
  input: { params: Promise<P>; searchParams: Promise<URLSearchParams> },
) => Response {
  const keepaliveMs = options.keepaliveMs ?? KEEPALIVE_MS;

  return (request, input) => {
    const controller = new AbortController();
    const encoder = new TextEncoder();

    request.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(sink) {
        // The retry hint first, so a browser that loses the connection waits
        // a moment rather than hammering.
        sink.enqueue(encoder.encode("retry: 1000\n\n"));

        const keepalive = setInterval(() => {
          try {
            sink.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // Closed between the check and the write; the loop below ends it.
          }
        }, keepaliveMs);

        try {
          for await (const value of produce({
            ...input,
            signal: controller.signal,
            request,
          })) {
            if (controller.signal.aborted) break;

            sink.enqueue(encoder.encode(frame(value)));
          }
        } catch (error) {
          if (!controller.signal.aborted) sink.error(error);
        } finally {
          clearInterval(keepalive);

          if (!controller.signal.aborted) {
            try {
              sink.close();
            } catch {
              // Already closed by the consumer.
            }
          }
        }
      },
      cancel() {
        controller.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        // Nginx buffers by default, which turns a stream into one late burst.
        "X-Accel-Buffering": "no",
      },
    });
  };
}
