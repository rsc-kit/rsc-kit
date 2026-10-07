"use client";

import { useCallback, useLayoutEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "../action.js";

// Any built action: createActionClient's handler(), with or without a schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<ActionResult<any, any>>;

type DataOf<A extends AnyAction> = Awaited<ReturnType<A>> extends ActionResult<infer D, any> ? D : never;

type RefusalOf<A extends AnyAction> = Awaited<ReturnType<A>> extends ActionResult<any, infer R> ? R : never;

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
  optimistic?: (...args: Parameters<A>) => void;
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
 * set, because the page is on its way somewhere else.
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

  const run = useCallback(async (args: Parameters<A>): Promise<Result> => {
    const { action, options } = latest.current;

    options.optimistic?.(...args);

    let next: Result;

    try {
      next = (await action(...args)) as Result;
    } catch (error) {
      next = { serverError: error instanceof Error ? error.message : String(error) };
    }

    if (next.redirected !== undefined) return next;

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
    (...args: Parameters<A>): Promise<Result> =>
      new Promise((resolve) => {
        startTransition(async () => {
          resolve(await run(args));
        });
      }),
    [run],
  );

  const execute = useCallback(
    (...args: Parameters<A>): void => {
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
