"use client";

/**
 * A value read again on an interval, as state - until it settles, if asked.
 *
 *     const { data } = usePolling(() => fetchQuery(getSeats, []), { every: 2_000 })
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

import { useCallback, useEffect, useRef, useState } from "react";

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
  const latest = useRef({
    read,
    onData: options.onData,
    until: options.until,
    onSettled: options.onSettled,
  });

  latest.current = {
    read,
    onData: options.onData,
    until: options.until,
    onSettled: options.onSettled,
  };

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<PollingState<T>["status"]>(
    enabled ? "reading" : "idle",
  );
  const inFlight = useRef<Promise<void> | null>(null);
  // Settled is a stop: the interval is cleared and stays cleared until
  // refresh() or a change of inputs. Kept in a ref as well as state, so the
  // interval callback sees it without a re-render in between.
  const isSettled = useRef(false);

  const refresh = useCallback(async () => {
    // Never two at once: a slow answer and a fast interval would otherwise
    // pile reads up, and the last to land wins whether or not it was newest.
    if (inFlight.current) return inFlight.current;

    // A read after settling is asked for: refresh() starts the clock again.
    if (isSettled.current) {
      isSettled.current = false;
      setStatus("reading");
    }

    inFlight.current = (async () => {
      try {
        const next = await latest.current.read();

        setData(next);
        setError(null);
        latest.current.onData?.(next);

        if (latest.current.until?.(next)) {
          isSettled.current = true;
          setStatus("settled");
          latest.current.onSettled?.(next);
        }
      } catch (e) {
        setError(e);
      } finally {
        inFlight.current = null;
      }
    })();

    return inFlight.current;
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
