export class ServerValidationError extends Error {
  public readonly errors: Record<string, string[]>;

  constructor(message: string, errors: Record<string, string[]>) {
    super(message);
    this.name = "ServerValidationError";
    this.errors = errors;
  }
}

/** An action answered with a location instead of a result. */
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
  if (response.ok) return;

  // Auth and explicit redirects travel as a header, whatever the status.
  const location = response.headers.get("X-RSC-Redirect");

  if (location !== null && location !== "") {
    throw new ServerRedirectError(location);
  }

  if (response.status === 422) {
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; errors?: Record<string, string[]> }
      | null;

    throw new ServerValidationError(
      payload?.message ?? "Validation failed",
      payload?.errors ?? {},
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

  throw new Error(`RSC payload request failed with ${response.status}`);
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

  console.error(`[rsc-router] ${scope}`, error);
}
