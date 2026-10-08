"use client";

/**
 * Performs a redirect, or shows a missing page, that was decided too late to
 * be a status code.
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
 * A page that said it does not exist, after its shell was sent, arrives the
 * same way and is answered the same way: the server is asked for not-found.tsx
 * for this url and it is rendered where the page was, with the layouts kept and
 * the url and its history entry as they are. The status is already 200 and the
 * document says noindex; this is what a person sees.
 *
 * Anything that is neither is rethrown untouched, so an app's own error
 * boundaries still see the errors they exist for.
 */

import type { Route } from "../routes.js";
import { Component, createElement } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { parseRedirectDigest } from "../redirectDigest.js";
import { isNotFoundDigest } from "../notFound.js";
import { visit } from "./router";
import { DefaultRouteError } from "./DefaultRouteError";

interface Props {
  children: ReactNode;
  /** Shown while the navigation is in flight. Null keeps the space empty. */
  fallback?: ReactNode;
  /**
   * Whether what this boundary wraps is the page on screen. A segment keeps
   * pages alive behind the active one, each under its own boundary, and a
   * redirect caught on a page that is not showing is not performed — it was
   * already performed when it was. Shown again, the boundary renders the
   * page afresh, and a refusal that still stands redirects again.
   */
  active?: boolean;
}

interface State {
  redirecting: boolean;
  wasActive: boolean;
  /** A missing page that could not be answered with one: shown as the error it is. */
  failed: unknown;
  /** The children that said the page is missing, while not-found.tsx is being fetched. */
  asked: ReactNode | null;
  /** Whether not-found.tsx has been fetched and put where those children were. */
  answered: boolean;
  /** The children that are the answer, so a page replacing it is told from it. */
  shown: ReactNode | null;
}

export class RedirectBoundary extends Component<Props, State> {
  state: State = {
    redirecting: false,
    wasActive: this.props.active !== false,
    failed: null,
    asked: null,
    answered: false,
    shown: null,
  };

  static getDerivedStateFromError(error: unknown): Partial<State> | null {
    // Reading `digest` rather than the message: React replaces a server
    // error's message in production and transmits the digest either way.
    const digest = (error as { digest?: unknown })?.digest;

    return parseRedirectDigest(digest) || isNotFoundDigest(digest) ? { redirecting: true } : null;
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    const active = props.active !== false;
    let next: Partial<State> = {};

    // Revealed again: render the page, not the space left by its redirect.
    if (active !== state.wasActive) {
      next = { wasActive: active, redirecting: active ? false : state.redirecting };
    }

    // The tree that stands for a missing page has replaced the one that threw:
    // render it. Not before the answer is in - a parent rendering again hands
    // down new children that are the same page, and rendering those would
    // throw again.
    if (state.asked !== null && state.answered && props.children !== state.asked) {
      next = { ...next, asked: null, shown: props.children, redirecting: false };
    } else if (state.shown !== null && props.children !== state.shown) {
      // Something else took its place - the person came back to a page that
      // exists now. The next missing page is a first one again.
      next = { ...next, shown: null, answered: false };
    }

    return Object.keys(next).length ? next : null;
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    const digest = (error as { digest?: unknown })?.digest;

    if (isNotFoundDigest(digest)) return this.showNotFound(error);

    const target = parseRedirectDigest(digest);

    if (!target) throw error;
    if (this.props.active === false) return;

    // An SPA navigation, not a location assignment: the layouts above this
    // boundary are already mounted and correct, so replacing the document
    // would throw away state the user can see — including whatever they had
    // typed into a page that is only being redirected past.
    //
    // replace, because the url being left never became a page the user was
    // on; leaving a history entry for it means Back returns to a redirect.
    // The server chose this, so it is not one of the app's authored hrefs.
    void visit(target.location as Route, { replace: true });
  }

  private showNotFound(error: unknown): void {
    if (this.props.active === false) return;

    // The answer itself said the page is missing: a not-found.tsx that calls
    // notFound() would otherwise be answered with itself for ever. It is
    // shown as the error it has become.
    if (this.state.answered) {
      this.setState({ failed: error });

      return;
    }

    const here = window.location.pathname + window.location.search;

    this.setState({ asked: this.props.children });

    // replace: the url is the page's own, and nothing was pushed for it to
    // leave behind. Not-found.tsx replaces the page in the history entry the
    // person is already on.
    visit(here as Route, { replace: true, notFound: true }).then(
      () => this.setState({ answered: true }),
      // Announced by the navigation as rsc-navigate-error. The person is left
      // with the error the page would have shown, not an empty space.
      () => this.setState({ failed: error }),
    );
  }

  render(): ReactNode {
    if (this.state.failed) {
      return createElement(DefaultRouteError as never, {
        error: this.state.failed,
        reset: () => this.setState({ failed: null, redirecting: false }),
      });
    }

    if (this.state.redirecting) return this.props.fallback ?? null;

    return this.props.children;
  }
}
