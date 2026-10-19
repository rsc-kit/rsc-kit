/**
 * What instrumentation.ts's onRequest() is told, once a response is over.
 *
 * "Over" is the part an app cannot see for itself: a page streams, so the
 * handler has long returned when the last byte leaves, and a visitor who
 * closes the tab mid-stream ends it early. Only the engine holds the body, so
 * only the engine can say which happened, and when.
 */
export interface ServedRequest {
  method: string;
  /** The url's path, never its query string: a query carries what people typed. */
  pathname: string;
  status: number;
  /** From the request arriving to the last byte sent, or to the stream ending early. */
  durationMs: number;
  /** The client went away before the body was sent - a closed tab, a navigation elsewhere. */
  aborted: boolean;
  /** The render failed: the handler threw, or the body errored partway. */
  error?: unknown;
  /**
   * Only the headers instrumentation.ts names in `onRequestHeaders`, by
   * lowercase name, and only those the request had. Nothing else is passed:
   * not cookies, not authorization.
   */
  headers: Readonly<Record<string, string>>;
}

export type OnRequest = (served: ServedRequest) => unknown;

/**
 * Run the handler and call onRequest once the response it answers is over.
 *
 * The body is passed through rather than read, so streaming is untouched: each
 * chunk goes out as it is produced. onRequest is never awaited and a throw
 * from it is reported, not raised - a logger that fails must not fail the page.
 */
export async function observeServed(
  request: Request,
  serve: (request: Request) => Promise<Response>,
  onRequest: OnRequest,
  headerNames: readonly string[] = [],
): Promise<Response> {
  const started = performance.now();
  let reported = false;

  const report = (status: number, aborted: boolean, error?: unknown) => {
    if (reported) return;
    reported = true;

    const served: ServedRequest = {
      method: request.method,
      pathname: new URL(request.url).pathname,
      status,
      durationMs: performance.now() - started,
      aborted,
      headers: pickHeaders(request.headers, headerNames),
      ...(error === undefined ? {} : { error }),
    };

    try {
      Promise.resolve(onRequest(served)).catch(failed);
    } catch (thrown) {
      failed(thrown);
    }
  };

  let response: Response;

  try {
    response = await serve(request);
  } catch (error) {
    report(500, false, error);
    throw error;
  }

  if (!response.body) {
    report(response.status, false);
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          report(response.status, false);
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        report(response.status, false, error);
      }
    },
    cancel(reason) {
      report(response.status, true);
      return reader.cancel(reason);
    },
  });

  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function pickHeaders(headers: Headers, names: readonly string[]): Readonly<Record<string, string>> {
  const picked: Record<string, string> = {};

  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) picked[name.toLowerCase()] = value;
  }

  return Object.freeze(picked);
}

function failed(error: unknown): void {
  console.error("[rsc-kit] instrumentation.ts onRequest() failed:", error);
}
