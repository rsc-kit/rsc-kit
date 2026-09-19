"use client";

/**
 * A stream of server-sent events, as state.
 *
 *     const { latest, status } = useEvents(`/api/orders/${id}/events`)
 *
 * Subscribes in an effect, so it is safe in a component that also renders on
 * the server. The browser's EventSource reconnects on its own and resumes
 * with Last-Event-ID when the route yielded ids; `status` says where it is.
 * `onMessage` is for a store that already holds the value - TanStack's
 * setQueryData, SWR's mutate, a setState - and `latest` for when the hook is
 * the store.
 */

import { useEffect, useRef, useState } from "react";

export type EventsStatus = "connecting" | "open" | "closed";

export interface EventsOptions<T> {
  /** Off, and nothing connects. For a stream that waits on an id. */
  enabled?: boolean;
  /** Listen to one named event rather than the unnamed stream. */
  event?: string;
  /** Every message, as it arrives. */
  onMessage?: (message: T) => void;
  /**
   * The connection failed or dropped. EventSource reconnects on its own, so
   * this is for a notice, not a retry; `status` says whether it gave up.
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

export function useEvents<T = unknown>(
  url: string,
  options: EventsOptions<T> = {},
): EventsState<T> {
  const { enabled = true, event, keep = 100 } = options;
  const onMessage = useRef(options.onMessage);
  const onError = useRef(options.onError);

  onMessage.current = options.onMessage;
  onError.current = options.onError;

  const [latest, setLatest] = useState<T | null>(null);
  const [all, setAll] = useState<T[]>([]);
  const [status, setStatus] = useState<EventsStatus>(
    enabled ? "connecting" : "closed",
  );
  const [error, setError] = useState<Event | null>(null);
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setStatus("closed");

      return;
    }

    const es = new EventSource(url);

    source.current = es;
    setStatus("connecting");
    setError(null);

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
      onMessage.current?.(message);
    };

    es.onopen = () => setStatus("open");
    es.onerror = (e) => {
      setError(e);
      onError.current?.(e);
      // EventSource reconnects on its own; CLOSED means it gave up.
      setStatus(es.readyState === EventSource.CLOSED ? "closed" : "connecting");
    };

    if (event) es.addEventListener(event, receive as EventListener);
    else es.onmessage = receive;

    return () => {
      es.close();
      source.current = null;
    };
  }, [url, enabled, event, keep]);

  return {
    latest,
    all,
    status,
    error,
    close: () => {
      source.current?.close();
      source.current = null;
      setStatus("closed");
    },
  };
}
