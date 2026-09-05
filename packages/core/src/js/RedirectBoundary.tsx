"use client";

/**
 * Performs a redirect that was decided too late to be a status code.
 *
 * A redirect thrown above every Suspense boundary is answered by the host
 * before anything is written — the browser never sees this page, and this
 * component is never involved. One thrown inside a boundary arrives after the
 * shell, as an error carrying the destination in its digest, and this is what
 * turns that back into a navigation.
 *
 * An error boundary rather than a hook because that is the only thing React
 * offers for "a child threw": the throw happens in a server component whose
 * error is serialised into the payload, and it surfaces here when the client
 * renders it.
 *
 * Anything that is not a redirect is rethrown untouched, so an app's own error
 * boundaries still see the errors they exist for.
 */

import type { Href } from "../routes.js";
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { parseRedirectDigest } from "../redirectDigest.js";
import { visit } from "./router";

interface Props {
  children: ReactNode;
  /** Shown while the navigation is in flight. Null keeps the space empty. */
  fallback?: ReactNode;
}

interface State {
  redirecting: boolean;
}

export class RedirectBoundary extends Component<Props, State> {
  state: State = { redirecting: false };

  static getDerivedStateFromError(error: unknown): State | null {
    // Reading `digest` rather than the message: React replaces a server
    // error's message in production and transmits the digest either way.
    return parseRedirectDigest((error as { digest?: unknown })?.digest)
      ? { redirecting: true }
      : null;
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const target = parseRedirectDigest((error as { digest?: unknown })?.digest);

    if (!target) throw error;

    // An SPA navigation, not a location assignment: the layouts above this
    // boundary are already mounted and correct, so replacing the document
    // would throw away state the user can see — including whatever they had
    // typed into a page that is only being redirected past.
    //
    // replace, because the url being left never became a page the user was
    // on; leaving a history entry for it means Back returns to a redirect.
    // The server chose this, so it is not one of the app's authored hrefs.
    void visit(target.location as Href, { replace: true });
  }

  render(): ReactNode {
    if (this.state.redirecting) return this.props.fallback ?? null;

    return this.props.children;
  }
}
