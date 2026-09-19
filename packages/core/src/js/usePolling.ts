"use client";

/**
 * A value read again on an interval, as state - until it settles, if asked.
 *
 *     const { data } = usePolling(() => fetchQuery(getSeats), { every: 2_000 })
 *
 *     // Until a job is done, then re-render the page that showed it.
 *     usePolling(() => fetchQuery(jobStatus, [id]), {
 *       every: 2_000,
 *       until: (job) => job.state === 'done' || job.state === 'failed',
 *       onSettled: () => refresh('page'),
 *     })
 *
 * The result is the data: whatever `read` returns is what `data` holds, and
 * a query's Cache-Control lets a CDN absorb a thousand tabs polling the same
 * thing into one origin request per interval. Settling is separate and
 * explicit: `until` says when a read is the last one, and `onSettled` fires
 * once on that read - so a page that wants to re-render through the server
 * path that built it calls refresh('page') there, and a page that wants the
 * value in hand reads `data`. Which of those is the page's to decide, not
 * the hook's.
 *
 * Pauses while the tab is hidden, never overlaps two reads, and `refresh()`
 * reads now - including after it settled, which starts it again.
 *
 * Polling against server-sent events: a stream sends bytes only when
 * something changed and arrives at once, but holds a connection per tab
 * and needs a source of change to yield from. Polling needs neither - it
 * reuses the query you wrote - and is cacheable. Start here when you have
 * no change feed yet; see useEvents when you do.
 */

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

export interface PollingOptions<T> {
  /** Milliseconds between reads. */
  every: number;
  enabled?: boolean;
  /** Every answer, as it arrives. */
  onData?: (data: T) => void;
  /** When a read is the last one: polling stops, and the answer is settled. */
  until?: (data: T) => boolean;
  /** Once, with the answer `until` accepted. */
  onSettled?: (data: T) => void;
  /**
   * Every read that failed. The next interval still reads; `error` is the
   * state. `failures` counts the failed reads in a row, so a third one can be
   * a toast where the first was a blip — a success resets it.
   */
  onError?: (error: unknown, info: { failures: number }) => void;
  /** Keep reading while the tab is hidden. Off by default. */
  whenHidden?: boolean;
}

export interface PollingState<T> {
  data: T | null;
  error: unknown;
  status: "idle" | "reading" | "paused" | "settled";
  /** Read now, outside the interval - and start again after settling. */
  refresh: () => Promise<void>;
}

export function usePolling<T>(
  read: () => Promise<T>,
  options: PollingOptions<T>,
): PollingState<T> {
  const { every, enabled = true, whenHidden = false } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const failures = useRef(0);
  const [status, setStatus] = useState<PollingState<T>["status"]>(
    enabled ? "reading" : "idle",
  );
  const inFlight = useRef<Promise<void> | null>(null);
  // Settled is a stop: the interval is cleared and stays cleared until
  // refresh() or a change of inputs. Kept in a ref as well as state, so the
  // interval callback sees it without a re-render in between.
  const isSettled = useRef(false);

  // One read, seeing the read function and callbacks of the latest render.
  // An Effect Event rather than a ref of the latest props: it is what React
  // provides for exactly this - a function the interval calls that must not
  // be a dependency of the interval, and must not go stale - and the
  // convention this package tells apps to use.
  const perform = useEffectEvent(async (): Promise<void> => {
    try {
      const next = await read();

      setData(next);
      setError(null);
      failures.current = 0;
      options.onData?.(next);

      if (options.until?.(next)) {
        isSettled.current = true;
        setStatus("settled");
        options.onSettled?.(next);
      }
    } catch (e) {
      failures.current += 1;
      setError(e);
      options.onError?.(e, { failures: failures.current });
    } finally {
      inFlight.current = null;
    }
  });

  // Stable, so a component can hand it to a button without re-rendering
  // subscribers on every poll. It only ever runs from an effect's interval or
  // an event handler, never during render, which is what an Effect Event
  // asks of its callers. `perform` is deliberately not a dependency: an
  // Effect Event is never one - React hands out a fresh wrapper per render,
  // every one of which calls the latest implementation - and listing it
  // would recreate refresh on every render, re-run the interval effect that
  // depends on refresh, and poll on each render forever.
  const refresh = useCallback(async () => {
    // Never two at once: a slow answer and a fast interval would otherwise
    // pile reads up, and the last to land wins whether or not it was newest.
    if (inFlight.current) return inFlight.current;

    // A read after settling is asked for: refresh() starts the clock again.
    if (isSettled.current) {
      isSettled.current = false;
      setStatus("reading");
    }

    inFlight.current = perform();

    return inFlight.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");

      return;
    }

    let timer: ReturnType<typeof setInterval> | null = null;

    isSettled.current = false;

    const start = () => {
      if (timer) return;

      setStatus("reading");
      void refresh();
      timer = setInterval(() => {
        if (!isSettled.current) void refresh();
      }, every);
    };
    const stop = () => {
      if (timer) clearInterval(timer);

      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setStatus("paused");
      } else {
        start();
      }
    };

    if (
      whenHidden ||
      typeof document === "undefined" ||
      document.visibilityState !== "hidden"
    )
      start();
    else setStatus("paused");

    if (!whenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      stop();
      if (!whenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [enabled, every, whenHidden, refresh]);

  return { data, error, status, refresh };
}
