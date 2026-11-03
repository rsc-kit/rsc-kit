import { beforeAll, expect, test } from "bun:test";
import { createRscHandler } from "../../src/host";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("firstRender.test.ts");

/**
 * The first page after a start names every chunk the second does.
 *
 * A client component's chunk is loaded the first time a payload names it, and
 * @vitejs/plugin-rsc asks for its modulepreload as it loads - filed under the
 * render the call is made inside. Decoded before the render, the first page
 * was inside none and named 3 of its 12 chunks. Its own file, so nothing has
 * rendered in this process before it.
 */
let engine: any;

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import("./goHost");

  await buildFixtureOnce();
  engine = await import(bundlePath);
  engine.installHostFn(async () => ({ display: "Ada" }));
}, 300_000);

test("names the same chunks as the second", async () => {
  const handler = createRscHandler({ engine: { ...engine, manifest: engine.manifest }, manifest: engine.manifest() } as never);
  const page = async () => (await (await handler(new Request("https://fixture.test/")))!.text()).match(/<link rel="modulepreload"[^>]*>/g);

  const first = await page();
  const second = await page();

  expect(first!.length).toBeGreaterThan(1);
  // The same set. The order is the order they loaded in, the first time.
  expect([...first!].sort()).toEqual([...second!].sort());
});
