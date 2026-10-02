"use client";

/**
 * A stream of server-sent events, as state.
 *
 *     const { latest, status } = useEvents(`/api/orders/${id}/events`)
 *
 * A message is typed from the route: the build records what each `events()`
 * route yields, so `latest` is what the generator sends, and a route that
 * changes it fails the typecheck here rather than in the browser. Another
 * site's stream, or one written without `events()`, is `unknown`; name its
 * type with `useEvents<Message>(url)`.
 *
 * Subscribes in an effect, so it is safe in a component that also renders on
 * the server. The browser's EventSource reconnects on its own after a dropped
 * connection and resumes with Last-Event-ID when the route yielded ids. What
 * it does not survive is an error answer - a 502 while a deploy restarts, a
 * proxy's timeout page - after which it closes for good; the hook opens a new
 * one, backing off from a second to thirty, and at once when the browser comes
 * back online. `status` says where it is; `close()` stops it.
 *
 * `onMessage` is for a store that already holds the value - TanStack's
 * setQueryData, SWR's mutate, a setState - and `latest` for when the hook is
 * the store.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MessageOf, NamedMessageOf } from "../events.js";
import type { EventsAt, EventsUrl } from "../routes.js";

export type EventsStatus = "connecting" | "open" | "closed";

export interface EventsOptions<T, E extends string | undefined = string | undefined> {
  /** Off, and nothing connects. For a stream that waits on an id. */
  enabled?: boolean;
  /** Listen to one named event rather than the unnamed stream. */
  event?: E;
  /** Every message, as it arrives. */
  onMessage?: (message: T) => void;
  /**
   * The connection failed or dropped. The hook reconnects on its own, so
   * this is for a notice, not a retry.
   */
  onError?: (error: Event) => void;
  /** How many messages `all` keeps. Default 100; 0 keeps none. */
  keep?: number;
}

export interface EventsState<T> {
  latest: T | null;
  all: T[];
  status: EventsStatus;
  error: Event | null;
  /** Close the stream for good; the hook will not reconnect. */
  close: () => void;
}

/** What the hook receives from `Y`'s yields: the unnamed messages, or those named `E`. */
type Received<Y, E> = unknown extends Y
  ? unknown
  : E extends string
    ? NamedMessageOf<Y, E>
    : MessageOf<Y>;

/** The longest wait between attempts after the browser gave up. */
const MAX_BACKOFF_MS = 30_000;

export function useEvents<const U extends EventsUrl, const E extends string | undefined = undefined>(
  url: U,
  options?: EventsOptions<Received<EventsAt<U>, E>, E>,
): EventsState<Received<EventsAt<U>, E>>;
export function useEvents<T>(url: EventsUrl, options?: EventsOptions<T>): EventsState<T>;
export function useEvents<T>(
  url: string,
  options: EventsOptions<T> = {},
): EventsState<T> {
  const { enabled = true, event, keep = 100 } = options;
  // Effect Events: the connection is opened once per url, and the handlers
  // it calls see the callbacks of the latest render without being the
  // effect's dependencies - which would reopen the connection on every
  // render that passed a new arrow.
  const onMessage = useEffectEvent((message: T) => options.onMessage?.(message));
  const onError = useEffectEvent((event: Event) => options.onError?.(event));

  const [latest, setLatest] = useState<T | null>(null);
  const [all, setAll] = useState<T[]>([]);
  const [status, setStatus] = useState<EventsStatus>(
    enabled ? "connecting" : "closed",
  );
  const [error, setError] = useState<Event | null>(null);
  // Ends this url's connection and any retry waiting to open the next one.
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setStatus("closed");

      return;
    }

    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const receive = (e: MessageEvent) => {
      let message: T;

      try {
        message = JSON.parse(e.data) as T;
      } catch {
        message = e.data as T;
      }

      setLatest(message);
      if (keep > 0)
        setAll((prev) =>
          prev.length >= keep
            ? [...prev.slice(1), message]
            : [...prev, message],
        );
      onMessage(message);
    };

    const connect = () => {
      clearTimeout(retry);
      retry = undefined;

      const source = new EventSource(url);

      es = source;
      setStatus("connecting");

      source.onopen = () => {
        failures = 0;
        setError(null);
        setStatus("open");
      };
      source.onerror = (e) => {
        setError(e);
        onError(e);

        // Still CONNECTING: the browser is retrying a dropped connection
        // itself. CLOSED: it gave up, and only a new EventSource comes back.
        if (source.readyState !== EventSource.CLOSED) {
          setStatus("connecting");

          return;
        }

        source.close();
        if (stopped) return;

        setStatus("connecting");
        retry = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** failures++));
      };

      if (event) source.addEventListener(event, receive as EventListener);
      else source.onmessage = receive;
    };

    // Back online: try now rather than at the end of the backoff.
    const online = () => {
      if (!stopped && retry !== undefined) connect();
    };

    connect();
    window.addEventListener("online", online);

    const end = () => {
      stopped = true;
      clearTimeout(retry);
      es?.close();
      window.removeEventListener("online", online);
    };

    stop.current = end;

    return () => {
      end();
      if (stop.current === end) stop.current = null;
    };
  }, [url, enabled, event, keep]);

  return {
    latest,
    all,
    status,
    error,
    close: () => {
      stop.current?.();
      stop.current = null;
      setStatus("closed");
    },
  };
}
