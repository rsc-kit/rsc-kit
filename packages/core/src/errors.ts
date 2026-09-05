/**
 * The worker's own error types.
 *
 * A separate set from `src/js/errors.ts` on purpose: these are thrown inside
 * the worker and turned into HTTP statuses, so they never reach the browser as
 * objects — the client reconstructs its own from the response. The public
 * `@rsc-kit/core/errors` specifier is the client's module, because that is
 * the one an `instanceof` in a component has to match.
 */
export class ServerValidationError extends Error {
  public readonly errors: Record<string, string[]>;

  constructor(message: string, errors: Record<string, string[]>) {
    super(message);
    this.name = "ServerValidationError";
    this.errors = errors;
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

export class ServerRedirectError extends Error {
  public readonly location: string;

  constructor(location: string) {
    super(`Redirect to ${location}`);
    this.name = "ServerRedirectError";
    this.location = location;
  }
}
