import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prerender } from "../../src/prerender";
import { prerenderApiRoutes } from "../../src/apiPrerender";
import { prerenderedFrom, writeTo } from "../../src/files";
import { createRscHandler } from "../../src/host";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("identify.test.ts");

/**
 * What a response says about itself. How it was served is always said - a
 * CDN rule or a check keys on it, and it names no product. What built it is
 * the name only, never the version, and off for a policy that strips it.
 */
let engine: any;
let manifest: any;
let out: string;

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import("./goHost");

  await buildFixtureOnce();
  engine = await import(bundlePath);
  manifest = engine.manifest();
  out = mkdtempSync(join(tmpdir(), "identify-"));

  await prerender({
    engine,
    write: writeTo(out),
    version: "b1",
    manifest: {
      ...manifest,
      routes: manifest.routes.filter(
        (r: any) => r.component === "app/static/page",
      ),
    },
  });
  await prerenderApiRoutes(engine, manifest, writeTo(out));
}, 300_000);

const handler = (identify: boolean) =>
  createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: { ...manifest, build: { ...manifest.build, identify } },
    prerendered: prerenderedFrom(out),
  } as never);

describe("how a response was served", () => {
  test("is said on every answer: rendered, stored, and a stored api answer", async () => {
    const h = handler(true);

    expect(
      (await h(new Request("https://fixture.test/")))!.headers.get("x-rsc-kit"),
    ).toBe("rendered");
    expect(
      (await h(new Request("https://fixture.test/static")))!.headers.get(
        "x-rsc-kit",
      ),
    ).toBe("stored");
    expect(
      (await h(new Request("https://fixture.test/api/pricing")))!.headers.get(
        "x-rsc-kit",
      ),
    ).toBe("stored");
  });

  test("and still said when the name is not", async () => {
    const res = await handler(false)(
      new Request("https://fixture.test/static"),
    );

    expect(res!.headers.get("x-rsc-kit")).toBe("stored");
    expect(res!.headers.get("x-powered-by")).toBeNull();
  });
});

describe("what built it", () => {
  test("is the name, in a header and a generator tag, and never the version", async () => {
    const res = await handler(true)(new Request("https://fixture.test/"));
    const html = await res!.text();

    expect(res!.headers.get("x-powered-by")).toBe("rsc-kit");
    expect(html).toContain('<meta name="generator" content="rsc-kit"/>');
    expect(html).not.toMatch(/generator" content="rsc-kit[ @/]\d/);
    expect(res!.headers.get("x-powered-by")).not.toMatch(/\d/);
  });
});
