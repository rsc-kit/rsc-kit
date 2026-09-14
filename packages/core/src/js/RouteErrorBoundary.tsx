'use client'

// The boundary an `error.tsx` is rendered inside.
//
// A class, because catching a render error is the one thing React still has no
// hook for. It is a CLIENT component and has to be: a server component cannot
// catch what happens in the browser, and `reset` is a callback the browser
// calls.
//
// One of these wraps each segment that has an error.tsx above it, innermost
// first, so the nearest file to the failure is the one that answers — the same
// rule loading.tsx follows.

import { Component, createElement, type ReactNode } from 'react'

export interface RouteErrorProps {
  /** What was thrown. In production React replaces the message with a digest. */
  error: Error & { digest?: string }
  /** Render the segment again. For a failure that might not happen twice. */
  reset: () => void
}

interface Props {
  fallback: (props: RouteErrorProps) => ReactNode
  children?: ReactNode
  /**
   * Changes when the route does.
   *
   * Without it a boundary that caught an error stays caught: navigating away
   * from a broken page would leave its error on screen over the new one, and
   * the only way out would be a reload.
   */
  resetKey: string
}

interface State {
  error: (Error & { digest?: string }) | null
  /** The route the error belongs to, so a new one clears it. */
  from: string
}

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, from: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A navigation clears it. Compared rather than keyed from outside, because
    // remounting the boundary on every navigation would throw away the subtree
    // it is wrapping along with the error.
    if (state.error && state.from !== props.resetKey) return { error: null, from: props.resetKey }
    if (state.from !== props.resetKey) return { from: props.resetKey }

    return null
  }

  componentDidCatch(error: Error): void {
    // Reported as well as rendered. A boundary that swallows the error leaves
    // nothing in the console for whoever has to find the cause.
    console.error(error)
  }

  render(): ReactNode {
    const { error } = this.state

    if (!error) return this.props.children

    return createElement(this.props.fallback, {
      error,
      reset: () => this.setState({ error: null }),
    })
  }
}
