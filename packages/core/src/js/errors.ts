export class ServerValidationError extends Error {
  public readonly errors: Record<string, string[]>;

  constructor(message: string, errors: Record<string, string[]>) {
    super(message);
    this.name = "ServerValidationError";
    this.errors = errors;
  }
}

/** An action answered with a location instead of a result. */
/**
 * The redirect the last action answered with, for the one caller that asks.
 *
 * An action that redirects resolves - the navigation is already under way
 * and the caller has nothing to do - which leaves a form that wants to know
 * whether to say "saved" with no way to tell a redirect from a void answer.
 * callServer notes the destination here; <Form> clears it before its action
 * runs and reads it, always, right after its await - so a form only ever sees
 * a redirect its own action made. A note nobody reads (an action called
 * outside a Form) is cleared by the next form's submit instead of being taken
 * for that form's redirect. Nothing else needs to read it.
 */
let lastRedirect: string | null = null;

export function noteRedirected(location: string): void {
  lastRedirect = location;
}

/** The redirect the action just performed, if it did - read once. */
export function redirectedTo(): string | null {
  const location = lastRedirect;

  lastRedirect = null;

  return location;
}

export class ServerRedirectError extends Error {
  public readonly location: string;

  constructor(location: string) {
    super(`Server action redirected to ${location}`);
    this.name = "ServerRedirectError";
    this.location = location;
  }
}

export class ServerAuthenticationError extends Error {
  constructor(message: string = "Unauthenticated.") {
    super(message);
    this.name = "ServerAuthenticationError";
  }
}

export class ServerAuthorizationError extends Error {
  constructor(message: string = "This action is unauthorized.") {
    super(message);
    this.name = "ServerAuthorizationError";
  }
}

export class ServerDumpError extends Error {
  constructor() {
    super("Server returned a dump response.");
    this.name = "ServerDumpError";
  }
}

export class ServerSessionExpiredError extends Error {
  constructor(message: string = "Your session has expired. Please refresh the page.") {
    super(message);
    this.name = "ServerSessionExpiredError";
  }
}

/**
 * Turn a failed server-action response into the error it describes.
 *
 * A server action that does not succeed answers with JSON or a redirect
 * header rather than a Flight stream. Passing one of those to the Flight
 * decoder does not produce the server's message — it produces an internal
 * parser failure ("enqueueModel is not a function") or a truncated read
 * ("Connection closed."), which is what reached onError before this existed.
 *
 * Returns without throwing when the response is a stream to be decoded.
 */
export async function throwForFailedAction(response: Response): Promise<void> {
  // Before the status: a redirect the action asked for is a 204 with the
  // destination in this header - an ok answer with no Flight in it - and
  // an expired session's is a 401. Read first, the header decides for both.
  // Read after `ok`, the 204 fell through to the Flight decoder with an
  // empty body, and the form waited forever.
  const location = response.headers.get("X-RSC-Redirect");

  if (location !== null && location !== "") {
    throw new ServerRedirectError(location);
  }

  if (response.ok) return;

  if (response.status === 422) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; errors?: Record<string, string[]> }
      | null;

    throw new ServerValidationError(
      payload?.message ?? "Validation failed",
      payload?.errors ?? {},
    );
  }

  if (response.status === 413) {
    throw new Error(
      "Server action refused: the request body is larger than the server accepts. " +
        "A file upload is the usual cause; the limit is the host's maxActionBody.",
    );
  }

  throw new Error(`Server action failed with ${response.status}`);
}

/**
 * Reject a payload response that is not one.
 *
 * The page a PPR route serves is a static shell: real HTML, status 200, with
 * its Suspense fallbacks showing. Everything below them arrives in a second
 * request. If that request fails there is nothing on screen to say so — the
 * skeletons simply stay, for ever — and handing the failure body to the Flight
 * decoder reports the decoder's confusion rather than the status.
 */
export function throwForFailedPayload(response: Response): void {
  if (response.ok) return;

  // A 404 that is a payload is the not-found page, rendered: a url a
  // pattern's shell answered with a 200 and a page that, run for real,
  // found no row - a subcategory under the wrong category. The page is
  // what the visitor should see; refusing it left the shell's content on
  // screen with nothing hydrated behind it, and every tap dead.
  if (isPayload(response)) return;

  throw new Error(`RSC payload request failed with ${response.status}`);
}

/** Whether a response is a Flight payload, whatever its status. */
export function isPayload(response: Response): boolean {
  return (response.headers.get("Content-Type") ?? "").includes("text/x-component");
}

/**
 * Announce a failure that nothing else will.
 *
 * Dispatched as well as logged: an app that wants to replace a stuck skeleton
 * with something honest has no other way to find out.
 */
export function reportClientFailure(scope: string, error: unknown): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("rsc-client-error", { detail: { scope, error } }));
  }

  console.error(`[rsc-kit] ${scope}`, error);
}
