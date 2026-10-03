/**
 * Waking the renderer: a broadcast server announcing a change, and wakeOn
 * turning that into an ask - against a real WebSocket server playing the
 * broadcast server's part of the Pusher protocol.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { listenToBroadcast } from "../../src/broadcast";
import { changes, configureChanged, installBackendVersionSource, resetChanges, sign, wakeOn } from "../../src/changed";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("broadcast.test.ts");

type Socket = { send(text: string): void; close(): void };

/** A broadcast server: hands out connections, records what clients send. */
function broadcastServer() {
  const received: { event: string; data: unknown }[] = [];
  const sockets: Socket[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, srv) {
      return srv.upgrade(request) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        sockets.push(ws);
        ws.send(JSON.stringify({ event: "pusher:connection_established", data: JSON.stringify({ socket_id: "1.1" }) }));
      },
      message(ws, text) {
        const frame = JSON.parse(String(text));

        received.push(frame);
        if (frame.event === "pusher:subscribe") {
          ws.send(JSON.stringify({ event: "pusher_internal:subscription_succeeded", channel: frame.data.channel, data: "{}" }));
        }
      },
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    received,
    sockets,
    announce: (channel = "rsc-versions", event = "rsc.changed") => {
      for (const socket of sockets) socket.send(JSON.stringify({ event, channel, data: "{}" }));
    },
    stop: () => server.stop(true),
  };
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe("listening to a broadcast", () => {
  test("subscribes to the channel, wakes on the change event and on nothing else, and answers pings", async () => {
    const server = broadcastServer();
    let wakes = 0;
    const stop = listenToBroadcast({ url: server.url, key: "app-key" })(() => void wakes++);

    try {
      await settle();
      expect(server.received[0]).toEqual({ event: "pusher:subscribe", data: { channel: "rsc-versions" } });
      expect(wakes).toBe(1); // subscribed: catch up on anything missed

      server.announce();
      await settle();
      expect(wakes).toBe(2);

      server.announce("another-channel");
      server.announce("rsc-versions", "something.else");
      await settle();
      expect(wakes).toBe(2);

      for (const socket of server.sockets) socket.send(JSON.stringify({ event: "pusher:ping", data: {} }));
      await settle();
      expect(server.received.some((f) => f.event === "pusher:pong")).toBe(true);
    } finally {
      stop();
      server.stop();
    }
  });

  test("reconnects when the connection drops, and wakes once it is back", async () => {
    const server = broadcastServer();
    let wakes = 0;
    const stop = listenToBroadcast({ url: server.url, key: "app-key" })(() => void wakes++);

    try {
      await settle();
      expect(wakes).toBe(1);

      server.sockets.splice(0).forEach((s) => s.close());
      await settle(1_300);

      expect(server.sockets.length).toBe(1);
      expect(wakes).toBe(2);
    } finally {
      stop();
      server.stop();
    }
  });
});

describe("wakeOn", () => {
  afterEach(() => {
    installBackendVersionSource(null);
    resetChanges();
  });

  test("a wake makes the renderer ask now, not on its next interval", async () => {
    configureChanged({ secret: "wake-test" });

    let asks = 0;

    // A backend that answers at once, as Laravel does.
    installBackendVersionSource({
      changed: async () => {
        asks++;
        return {};
      },
      bump: () => {},
    });

    let wake: (() => void) | null = null;

    wakeOn((w) => {
      wake = w;
    });

    const controller = new AbortController();
    const response = await changes(
      new Request("https://app.test/_rsc/changes?w=" + encodeURIComponent(JSON.stringify([["inbox:7", 0, await sign("inbox:7")]])), {
        signal: controller.signal,
      }),
    );

    try {
      await settle(150);
      const before = asks;

      // With something to wake it, nothing is asked on a two-second timer.
      await settle(2_300);
      expect(asks).toBe(before);

      wake!();
      await settle(150);
      expect(asks).toBe(before + 1);
    } finally {
      controller.abort();
      await response.body?.cancel().catch(() => {});
    }
  });
});
