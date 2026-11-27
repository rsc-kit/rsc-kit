"use client";

import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "../action.js";
import { type Redirected, ServerValidationError, closeAnswer, isRedirected, openAnswer, redirectedBack } from "./errors.js";

// Any action: createActionClient's handler(), with or without a schema, or a
// plain "use server" function - the stub the build writes for a backend
// action is one, and resolves with its value rather than an ActionResult.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<any>;

type Resolved<A extends AnyAction> = Awaited<ReturnType<A>>;

// What it can be called with. A backend stub has two signatures - its own
// parameters, then the form that posts to it, last so a bind keeps the form's
// fields - and Parameters<> reads only the last: execute() on a stub that
// takes an optional object asked for a FormData. Matched against two, a
// function with one signature fills both from it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ArgsOf<A extends AnyAction> = A extends { (...args: infer First): any; (...args: infer Form): any }
  ? First | Form
  : Parameters<A>;

type DataOf<A extends AnyAction> =
  Resolved<A> extends ActionResult<infer D, any> ? D : Exclude<Resolved<A>, Redirected>;

type RefusalOf<A extends AnyAction> = Resolved<A> extends ActionResult<any, infer R> ? R : never;

/** The whole result, refusal type included - see `.refusal(schema)`. */
type ResultOf<A extends AnyAction> = ActionResult<DataOf<A>, RefusalOf<A>>;

export type UseActionStatus = "idle" | "executing" | "hasSucceeded" | "hasErrored";

export interface UseActionOptions<A extends AnyAction> {
  /**
   * Called inside the action's transition, before the action runs, with what
   * it was called with - where React's `useOptimistic` setter goes. React
   * puts the optimistic state back when the transition ends, so a failed
   * action takes its change back on its own.
   */
  optimistic?: (...args: ArgsOf<A>) => void;
  /** The action answered with data: no serverError, no validationErrors. */
  onSuccess?: (data: DataOf<A>) => void;
  /**
   * The action refused or failed. With a serverError, that message; with
   * validationErrors, the first one - so a button with no field beside it
   * still has something to show.
   */
  onError?: (message: string, result: ResultOf<A>) => void;
  /** After either, for state that tracks the call rather than its outcome. */
  onSettled?: (result: ResultOf<A>) => void;
}

/**
 * Call an action from a button rather than a form.
 *
 *     const { execute, isPending } = useAction(archivePost, {
 *       optimistic: (input) => hide(input.id),
 *       onError: (message) => toast.error(message),
 *     })
 *
 *     <button disabled={isPending} onClick={() => execute({ id })}>Archive</button>
 *
 * The action's own types carry through: `execute` takes what the action's
 * schema takes, and `onSuccess` is handed what its handler returns. A form does
 * not need this - <Form> reads the same result on its own.
 *
 * Neither `execute` nor `executeAsync` throws. An action built on the action
 * client returns its failures, and anything thrown on the way - the network,
 * a server that answered with a page - becomes a serverError: left thrown,
 * the transition never settled and an optimistic change stayed on screen as
 * though the write had worked.
 *
 * An action that redirected settles nothing: no callback runs and no state is
 * set, because the page is on its way somewhere else. A redirect back to the
 * page it was called from - Laravel's back() - is a success like any other.
 */
export function useAction<A extends AnyAction>(action: A, options: UseActionOptions<A> = {}) {
  type Result = ResultOf<A>;

  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>({});
  const [settled, setSettled] = useState<"hasSucceeded" | "hasErrored" | null>(null);

  // Read when the action runs, not when execute was made: execute keeps one
  // identity across renders, so an onClick built on it is not rebuilt, and a
  // callback closing over newer state is still the one called.
  const latest = useRef({ action, options });

  useLayoutEffect(() => {
    latest.current = { action, options };
  });

  const run = useCallback(async (args: ArgsOf<A>): Promise<Result> => {
    const { action, options } = latest.current;

    options.optimistic?.(...args);

    const from = window.location.pathname + window.location.search;
    let next: Result;

    try {
      // Open only for the call itself: React reaches the transport
      // synchronously, so nothing else can take it - see openAnswer().
      const answer = openAnswer();
      const pending = action(...args);

      closeAnswer();

      const value = await pending;

      // A stub's value is its data, and so is anything that is not an
      // object - a void stub resolves with null. Refusals reject, below.
      const data = answer.plain || typeof value !== "object" || value === null;

      next = (data && !isRedirected(value) ? { data: value } : value) as Result;
    } catch (error) {
      // A generated stub rejects when its input is refused, and a form or a
      // button reads that as it reads the result of an action built on the client.
      next =
        error instanceof ServerValidationError
          ? { validationErrors: error.errors }
          : { serverError: error instanceof Error ? error.message : String(error) };
    }

    // Gone elsewhere, nothing to settle - but back() to this page is the
    // action succeeding, and the page it re-rendered is still this one.
    if (next.redirected !== undefined && !redirectedBack(next.redirected, from)) return next;

    setResult(next);
    setSettled(next.serverError !== undefined || next.validationErrors ? "hasErrored" : "hasSucceeded");

    if (next.serverError !== undefined) {
      options.onError?.(next.serverError, next);
    } else if (next.validationErrors) {
      options.onError?.(Object.values(next.validationErrors).flat()[0] ?? "Invalid input.", next);
    } else {
      options.onSuccess?.(next.data as DataOf<A>);
    }

    options.onSettled?.(next);

    return next;
  }, []);

  const executeAsync = useCallback(
    (...args: ArgsOf<A>): Promise<Result> =>
      new Promise((resolve) => {
        startTransition(async () => {
          resolve(await run(args));
        });
      }),
    [run],
  );

  const execute = useCallback(
    (...args: ArgsOf<A>): void => {
      void executeAsync(...args);
    },
    [executeAsync],
  );

  const reset = useCallback(() => {
    setResult({});
    setSettled(null);
  }, []);

  const status: UseActionStatus = isPending ? "executing" : (settled ?? "idle");

  return { execute, executeAsync, isPending, status, result, reset };
}

export default useAction;
