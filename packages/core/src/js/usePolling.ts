"use client";

/**
 * A value read again on an interval, as state.
 *
 *     const { data } = usePolling(() => fetchQuery(getSeats, []), { every: 2_000 })
 *
 * The query stays the source: whatever `read` returns is what the page
 * shows, and a query's Cache-Control lets a CDN absorb a thousand tabs
 * polling the same thing into one origin request per interval. Pauses
 * while the tab is hidden, never overlaps two reads, and `refresh()` reads
 * now. `onData` is for a store that already holds the value.
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
  /** Keep reading while the tab is hidden. Off by default. */
  whenHidden?: boolean;
}

export interface PollingState<T> {
  data: T | null;
  error: unknown;
  status: "idle" | "reading" | "paused";
  /** Read now, outside the interval. */
  refresh: () => Promise<void>;
}

export function usePolling<T>(
  read: () => Promise<T>,
  options: PollingOptions<T>,
): PollingState<T> {
  const { every, enabled = true, whenHidden = false } = options;
  const latest = useRef({ read, onData: options.onData });

  latest.current = { read, onData: options.onData };

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<PollingState<T>["status"]>(
    enabled ? "reading" : "idle",
  );
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    // Never two at once: a slow answer and a fast interval would otherwise
    // pile reads up, and the last to land wins whether or not it was newest.
    if (inFlight.current) return inFlight.current;

    inFlight.current = (async () => {
      try {
        const next = await latest.current.read();

        setData(next);
        setError(null);
        latest.current.onData?.(next);
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

    const start = () => {
      if (timer) return;

      setStatus("reading");
      void refresh();
      timer = setInterval(() => void refresh(), every);
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
