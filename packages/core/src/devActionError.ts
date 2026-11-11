/**
 * A server action that failed, told to the browser in development.
 *
 * An action is a fetch from a page already on screen, so its failure has no
 * page of its own to replace: it left the renderer as the server's generic
 * 500 and reached the browser as "Server action failed with 500". The cause
 * - a missing $fillable in PHP, a nil map in Go - was in the terminal and
 * the network tab, and the page showed nothing at all.
 *
 * So in development the failure is answered with what it was: the message,
 * the renderer's stack, and the backend's own type and frames when a host
 * call failed there. The browser opens Vite's error overlay with it. Nothing
 * here is sent in production, where the visitor is not the developer.
 */

/** The header that marks the answer as this, so a proxy's own 500 is not read as one. */
export const DEV_ACTION_ERROR = "X-RSC-Dev-Error";

export interface DevActionError {
  message: string;
  /** The renderer's frames. */
  stack: string;
  /** Where the backend says it failed: Laravel's app.debug, Go's Debug. */
  backend?: { type: string; message: string; frames: string[] };
}

/** Whether the request is a server action's call. */
export function isActionCall(request: Request): boolean {
  return request.method === "POST" && request.headers.get("X-RSC-Action") !== null;
}

/**
 * What a failure says about itself. The backend's part is read from the
 * cause a failed host call carries (hostCalls' withBackendTrace).
 */
export function devActionError(error: unknown): DevActionError {
  const failure = error instanceof Error ? error : new Error(String(error));
  const marker = "\nCaused in the backend by ";
  const own = (failure.stack ?? failure.message).split(marker)[0]!;
  const cause = failure.cause;
  const described: DevActionError = { message: failure.message, stack: own };

  if (cause instanceof Error && cause.name.startsWith("Backend ")) {
    described.backend = {
      type: cause.name.slice("Backend ".length),
      message: cause.message,
      frames: (cause.stack ?? "")
        .split("\n")
        .filter((line) => line.startsWith("    at "))
        .map((line) => line.slice("    at ".length)),
    };
  }

  return described;
}

export function devActionErrorResponse(error: unknown): Response {
  return new Response(JSON.stringify(devActionError(error)), {
    status: 500,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      [DEV_ACTION_ERROR]: "1",
    },
  });
}
