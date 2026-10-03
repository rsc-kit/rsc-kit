// Waking on a broadcast: the renderer subscribes to one channel on a
// broadcast server - one speaking the Pusher protocol, which Laravel's
// Reverb, Pusher and Soketi all do - and is woken whenever a change is
// announced on it.
//
// The announcement carries nothing: no names, no data. Anyone may subscribe
// to a public channel, so what goes over it must be safe for anyone to see;
// "something changed" is. The renderer then asks wherever the versions live
// - the backend, through __rsc.changed - which answers for its visitor's
// names alone, as it always has.

/** Where the broadcast server is, and which channel and event mean "a version moved". */
export interface BroadcastOptions {
  /** The server: `wss://ws.example.com` or `http://localhost:8080` (http is read as ws). */
  url: string;
  /** The app key the server knows this app by (Laravel: REVERB_APP_KEY, or PUSHER_APP_KEY). */
  key: string;
  /** Default `rsc-versions`, the channel Laravel's Rsc::changed() broadcasts on. */
  channel?: string;
  /** Default `rsc.changed`, the event it broadcasts. */
  event?: string;
}

const PING_MS = 60_000;

/**
 * A `wakeOn` listener for a broadcast server:
 *
 *     wakeOn(listenToBroadcast({ url: 'wss://ws.example.com', key: process.env.REVERB_APP_KEY! }))
 *
 * or, with no code, `RSC_BROADCAST_URL` and `RSC_BROADCAST_KEY` in the
 * renderer's environment. Uses the runtime's own WebSocket - Bun, Node 22,
 * Deno - and reconnects with backoff when the connection drops, waking once
 * it is back, since anything announced while it was gone was lost.
 */
export function listenToBroadcast(
  options: BroadcastOptions,
): (wake: () => void) => () => void {
  const channel = options.channel ?? "rsc-versions";
  const event = options.event ?? "rsc.changed";
  const base = options.url.replace(/^http/, "ws").replace(/\/+$/, "");
  const url = `${base}/app/${encodeURIComponent(options.key)}?protocol=7&client=rsc-kit&version=1&flash=false`;

  return (wake) => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;
    let warned = false;

    const send = (message: unknown) => {
      try {
        socket?.send(JSON.stringify(message));
      } catch {
        // Closing; the close handler reconnects.
      }
    };

    const connect = () => {
      if (stopped) return;

      const WebSocketImpl = (globalThis as { WebSocket?: typeof WebSocket })
        .WebSocket;

      if (!WebSocketImpl) {
        console.warn(
          "[rsc-kit] listenToBroadcast needs a runtime with WebSocket (Bun, Node 22+): not listening.",
        );
        return;
      }

      const ws = new WebSocketImpl(url);

      socket = ws;

      ws.onmessage = (message: MessageEvent) => {
        let frame: { event?: string; channel?: string; data?: unknown };

        try {
          frame = JSON.parse(String(message.data)) as typeof frame;
        } catch {
          return;
        }

        if (frame.event === "pusher:connection_established") {
          send({ event: "pusher:subscribe", data: { channel } });
        } else if (frame.event === "pusher_internal:subscription_succeeded") {
          failures = 0;
          // Connected again after a drop: whatever was announced meanwhile is
          // gone, so ask now.
          wake();
        } else if (frame.event === "pusher:ping") {
          send({ event: "pusher:pong", data: {} });
        } else if (frame.event === "pusher:error") {
          if (!warned) {
            warned = true;
            console.warn(
              "[rsc-kit] the broadcast server refused: " +
                JSON.stringify(frame.data),
            );
          }
        } else if (frame.event === event && frame.channel === channel) {
          wake();
        }
      };

      ws.onclose = () => {
        clearInterval(ping);
        if (socket === ws) socket = null;
        if (stopped) return;

        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures++));
        (retry as { unref?: () => void }).unref?.();
      };

      ws.onerror = () => {
        // The close that follows reconnects.
      };

      // Some proxies drop a connection that only listens.
      ping = setInterval(
        () => send({ event: "pusher:ping", data: {} }),
        PING_MS,
      );
      (ping as { unref?: () => void }).unref?.();
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socket?.close();
    };
  };
}
