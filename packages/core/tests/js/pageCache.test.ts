import { beforeAll, describe, expect, test } from "bun:test";
import { createRscHandler } from "../../src/host";
import { payloadKey } from "../../src/js/payloadKey";
import { cachingOf, finishCacheable, publicCacheControl } from "../../src/pageCache";
import { renderingAsNobody } from "../../src/request";
import { revalidateOf } from "../../src/vite";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertServerRuntime } from "./serverRuntime";

assertServerRuntime("pageCache.test.ts");

/**
 * `export const revalidate = N`: a page a shared cache may keep, sent public
 * only when the render read nothing that belongs to one visitor - and private,
 * saying which check failed, otherwise.
 */
let engine: any;
let manifest: any;
/** Whether each backend call was made as nobody: no cookie forwarded, none kept. */
let calledAs: boolean[] = [];

beforeAll(async () => {
  const { buildFixtureOnce, bundlePath } = await import("./goHost");

  await buildFixtureOnce();
  engine = await import(bundlePath);
  manifest = engine.manifest();
  engine.installHostFn(async () => {
    calledAs.push(renderingAsNobody());

    return { display: "Ada" };
  });
}, 300_000);

/** The fixture's handler, with these pages exporting revalidate. */
const handler = (revalidate: Record<string, number>, hostMiddleware: Record<string, string[]> = {}) =>
  createRscHandler({
    engine: { ...engine, manifest: engine.manifest },
    manifest: {
      ...manifest,
      routes: manifest.routes.map((route: any) => ({
        ...route,
        revalidate: revalidate[route.component],
        hostMiddleware: hostMiddleware[route.component] ?? route.hostMiddleware,
      })),
    },
  } as never);

const navigation = (path: string, extra: Record<string, string> = {}) => {
  const headers = { "X-RSC": "1", "X-RSC-Segments": "app/layout", ...extra };

  return new Request(`https://fixture.test${path}${path.includes("?") ? "&" : "?"}_rsc=${payloadKey(headers)}`, { headers });
};

describe("a page that exports revalidate", () => {
  test("is public for shared caches only, with an ETag, when it read nothing of the visitor", async () => {
    const response = (await handler({ "app/page": 60 })(new Request("https://fixture.test/", { headers: { cookie: "session=abc" } })))!;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=86400");
    expect(response.headers.get("etag")).toMatch(/^"[0-9a-f]{24}"$/);
    expect(response.headers.get("cache-status")).toBeNull();
    expect(response.headers.get("vary")).toContain("X-RSC");
    expect(await response.text()).toContain("Ada</h1>");
  });

  test("calls its backend as nobody, so a session cookie set on every call cannot make it private", async () => {
    calledAs = [];
    await handler({ "app/page": 60 })(new Request("https://fixture.test/"));
    await handler({})(new Request("https://fixture.test/"));

    expect(calledAs).toEqual([true, false]);
  });

  test("and its navigation, asked for at its own url, is public too", async () => {
    const response = (await handler({ "app/page": 60 })(navigation("/")))!;

    expect(response.headers.get("content-type")).toContain("text/x-component");
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=86400");
  });

  test("answers 304 to a cache revalidating a copy that has not changed", async () => {
    const h = handler({ "app/page": 60 });
    const first = (await h(new Request("https://fixture.test/")))!;
    const etag = first.headers.get("etag")!;
    const again = (await h(new Request("https://fixture.test/", { headers: { "If-None-Match": etag } })))!;

    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(await again.text()).toBe("");
  });

  test("is private when a payload is asked for without its key, or with the wrong one", async () => {
    const h = handler({ "app/page": 60 });
    const unkeyed = (await h(new Request("https://fixture.test/", { headers: { "X-RSC": "1" } })))!;
    const wrong = (await h(new Request("https://fixture.test/?_rsc=nope", { headers: { "X-RSC": "1" } })))!;

    for (const response of [unkeyed, wrong]) {
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("cache-status")).toBe("rsc-kit; fwd=bypass; detail=payload-url");
    }
  });

  test("is private when a document is asked for at a payload's url: a cache would hand it to the navigation", async () => {
    const response = (await handler({ "app/page": 60 })(new Request("https://fixture.test/?_rsc=abc")))!;

    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-status")).toBe("rsc-kit; fwd=bypass; detail=payload-url");
  });

  test("is private, and says why, when its middleware read cookies and set one", async () => {
    const response = (await handler({ "app/writes/page": 60 })(new Request("https://fixture.test/writes")))!;

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cache-status")).toBe("rsc-kit; fwd=bypass; detail=cookies");
    expect(response.headers.get("etag")).toBeNull();
    // Still the page, whole.
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  test("is private when the route has host middleware, which runs against the visitor's session", async () => {
    const response = (await handler({ "app/page": 60 }, { "app/page": ["auth"] })(new Request("https://fixture.test/")))!;

    expect(response.headers.get("cache-status")).toBe("rsc-kit; fwd=bypass; detail=host-middleware");
  });

  test("that said notFound() leaves its judgement for the 404 the entry renders", async () => {
    const request = new Request("https://fixture.test/no-such-collection");
    const answer = await handler({ "app/[collection]/page": 60 })(request);

    expect(answer).toBeNull();
    expect(cachingOf(request)).toMatchObject({ revalidate: 60, refused: null });
  });

  test("whose navigation turned out to be not-found.tsx is kept no longer than a 404", async () => {
    // The payload is a 200 carrying notFound() as a row, which the browser's
    // boundary turns into not-found.tsx: the status line cannot say so.
    const response = (await handler({ "app/[collection]/page": 300 })(navigation("/no-such-collection")))!;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60");
  });

  test("a page without it is answered as it always was", async () => {
    const response = (await handler({})(new Request("https://fixture.test/")))!;

    expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("cache-status")).toBeNull();
  });
});

describe("the answer's headers", () => {
  test("keep a 404 for a minute at most, and a page for its own time", () => {
    expect(publicCacheControl(300, 404)).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60");
    expect(publicCacheControl(30, 404)).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=60");
    expect(publicCacheControl(300, 200)).toBe("public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
  });

  test("keep not-found.tsx's payload, answered 200 for the router, as briefly as its document", async () => {
    const entry = { revalidate: 300, path: "/gone", refused: null };
    const payload = new Response("0:null", { headers: { "Content-Type": "text/x-component" } });
    const kept = await finishCacheable(new Request("https://fixture.test/gone"), payload, entry, () => true);

    expect(kept.status).toBe(200);
    expect(kept.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60");
  });

  test("never make a redirect, a 5xx or a page carrying a CSP nonce public", async () => {
    const entry = { revalidate: 60, path: "/", refused: null };
    const request = new Request("https://fixture.test/");
    const html = { "Content-Type": "text/html" };

    const redirect = await finishCacheable(request, new Response(null, { status: 307, headers: { Location: "/x" } }), { ...entry });
    const failed = await finishCacheable(request, new Response("x", { status: 500, headers: html }), { ...entry });
    const nonce = await finishCacheable(
      request,
      new Response("x", { headers: { ...html, "Content-Security-Policy": "script-src 'nonce-abc'" } }),
      { ...entry },
    );

    expect(redirect.headers.get("cache-status")).toContain("detail=status");
    expect(failed.headers.get("cache-status")).toContain("detail=status");
    expect(nonce.headers.get("cache-status")).toContain("detail=nonce");
  });
});

describe("the value", () => {
  const files = (sources: Record<string, string>) => {
    const root = join(import.meta.dir, "../../.tmp");

    mkdirSync(root, { recursive: true });

    const dir = mkdtempSync(join(root, "revalidate-"));

    return Object.entries(sources).map(([name, src]) => {
      const file = join(dir, name);

      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, src);

      return file;
    });
  };

  test("is the smallest across the layouts and the page, and 0 anywhere means per request", () => {
    expect(revalidateOf(files({ "layout.tsx": "export const revalidate = 300", "page.tsx": "export const revalidate = 60" }))).toEqual({ revalidate: 60 });
    expect(revalidateOf(files({ "layout.tsx": "export const revalidate = 0", "page.tsx": "export const revalidate = 60" }))).toEqual({});
    expect(revalidateOf(files({ "page.tsx": "export default function Page() {}" }))).toEqual({});
  });

  test("must be a number the build can read", () => {
    expect(() => revalidateOf(files({ "page.tsx": "export const revalidate = MINUTE" }))).toThrow("number of seconds");
  });
});
