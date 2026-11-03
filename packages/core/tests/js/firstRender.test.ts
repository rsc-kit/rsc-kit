import { beforeAll, expect, test } from "bun:test";
import { createRscHandler } from "../../src/host";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("firstRender.test.ts");

/**
 * The first page after a start is the same page as every one after it.
 *
 * @vitejs/plugin-rsc asked for a client chunk's modulepreload while it first
 * loaded it, outside the render, where the hint was lost: the first document
 * named fewer chunks, in another order. A page a shared cache keeps then had a
 * different ETag once per start, and the first visitor preloaded less. Its own
 * file, so nothing has rendered in this process before it.
 */
let engine: any;

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import("./goHost");

  await buildFixtureOnce();
  engine = await import(bundlePath);
  engine.installHostFn(async () => ({ display: "Ada" }));
}, 300_000);

test("names the same chunks, in the same order, as the second", async () => {
  const handler = createRscHandler({ engine: { ...engine, manifest: engine.manifest }, manifest: engine.manifest() } as never);
  const page = async () => (await (await handler(new Request("https://fixture.test/")))!.text()).match(/<link rel="modulepreload"[^>]*>/g);

  const first = await page();
  const second = await page();

  expect(first!.length).toBeGreaterThan(1);
  expect(first).toEqual(second);
});
