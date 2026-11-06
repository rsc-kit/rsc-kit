import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { createRscHandler } from "../../src/host";
import { payloadKey } from "../../src/js/payloadKey";
import { cacheTagHeader, cachingOf, cdnCacheControl, createPageCache, finishCacheable, pageMemoryStore, publicCacheControl } from "../../src/pageCache";
import { installVersionSource, memoryVersions, versionSource } from "../../src/changed";
import { cache } from "../../src/cache";
import { cacheTagsRead, renderAsNobody, renderingAsNobody, withRequest } from "../../src/request";
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
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=86400, stale-if-error=86400");
    expect(response.headers.get("cdn-cache-control")).toBe("max-age=60, stale-while-revalidate=86400, stale-if-error=86400");
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
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=86400, stale-if-error=86400");
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
    expect(response.headers.get("cdn-cache-control")).toBeNull();
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
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=60");
    expect(response.headers.get("cdn-cache-control")).toBe("max-age=60, stale-while-revalidate=60, stale-if-error=60");
  });

  test("a page without it is answered as it always was", async () => {
    const response = (await handler({})(new Request("https://fixture.test/")))!;

    expect(response.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("cache-status")).toBeNull();
  });
});

describe("the answer's headers", () => {
  test("keep a 404 for a minute at most, and a page for its own time", () => {
    expect(publicCacheControl(300, 404)).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=60");
    expect(publicCacheControl(30, 404)).toBe("public, max-age=0, s-maxage=30, stale-while-revalidate=60, stale-if-error=60");
    expect(publicCacheControl(300, 200)).toBe("public, max-age=0, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400");
    expect(cdnCacheControl(300, 404)).toBe("max-age=60, stale-while-revalidate=60, stale-if-error=60");
    expect(cdnCacheControl(30, 404)).toBe("max-age=30, stale-while-revalidate=60, stale-if-error=60");
    expect(cdnCacheControl(300, 200)).toBe("max-age=300, stale-while-revalidate=86400, stale-if-error=86400");
  });

  test("never leave a CDN-Cache-Control a private answer was given on the way", async () => {
    const entry = { revalidate: 60, path: "/", refused: "cookies" };
    const page = new Response("<p>", { headers: { "Content-Type": "text/html", "CDN-Cache-Control": "max-age=600" } });
    const response = await finishCacheable(new Request("https://fixture.test/"), page, entry);

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("cdn-cache-control")).toBeNull();
  });

  test("keep not-found.tsx's payload, answered 200 for the router, as briefly as its document", async () => {
    const entry = { revalidate: 300, path: "/gone", refused: null };
    const payload = new Response("0:null", { headers: { "Content-Type": "text/x-component" } });
    const kept = await finishCacheable(new Request("https://fixture.test/gone"), payload, entry, () => true);

    expect(kept.status).toBe(200);
    expect(kept.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60, stale-while-revalidate=60, stale-if-error=60");
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

describe("the tags it read", () => {
  const entry = () => ({ revalidate: 60, path: "/posts/1", refused: null });
  const page = () => new Response("<h1>Post</h1>", { headers: { "Content-Type": "text/html" } });
  const post = cache(async (id: number) => ({ id }), { key: "test.post", revalidate: 60, tags: (id) => ["posts", `post:${id}`] });

  test("go on the kept answer as Cache-Tag, once each, so a CDN can purge it when one changes", async () => {
    const request = new Request("https://fixture.test/posts/1");
    const kept = await withRequest(request, async () => {
      renderAsNobody();
      await post(1);
      await post(1);

      return finishCacheable(request, page(), entry());
    });

    expect(kept.headers.get("cache-control")).toContain("public");
    expect(kept.headers.get("cache-tag")).toBe("posts,post:1");
  });

  test("are not collected in a page rendered per request, which no CDN keeps", async () => {
    const request = new Request("https://fixture.test/posts/1");
    const tags = await withRequest(request, async () => {
      await post(1);

      return cacheTagsRead();
    });

    expect(tags).toEqual([]);
  });

  test("are not sent on a page that was sent private", async () => {
    const request = new Request("https://fixture.test/posts/1");
    const sent = await withRequest(request, async () => {
      renderAsNobody();
      await post(1);

      return finishCacheable(request, new Response("x", { headers: { "Content-Type": "text/html", "Set-Cookie": "a=1" } }), entry());
    });

    expect(sent.headers.get("cache-control")).toBe("private, no-store");
    expect(sent.headers.get("cache-tag")).toBeNull();
  });

  test("leave out one the header cannot carry, rather than split it", () => {
    expect(cacheTagHeader(["posts", "a,b", "with space", "post:1"])).toBe("posts,post:1");
    expect(cacheTagHeader([])).toBeNull();
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

describe("the engine's own copy", () => {
  const calls = async (h: (request: Request) => Promise<Response | null>, request: () => Request) => {
    calledAs = [];
    const response = (await h(request()))!;

    return { response, calls: calledAs.length };
  };

  test("serves the second request without a render, and says how old it is", async () => {
    const h = handler({ "app/page": 60 });
    const first = await calls(h, () => new Request("https://fixture.test/"));
    const second = await calls(h, () => new Request("https://fixture.test/"));

    expect(first.calls).toBeGreaterThan(0);
    expect(first.response.headers.get("x-rsc-kit")).toBe("rendered");
    expect(second.calls).toBe(0);
    expect(second.response.headers.get("x-rsc-kit")).toBe("cached");
    expect(second.response.headers.get("age")).toBe("0");
    expect(second.response.headers.get("cache-control")).toBe(first.response.headers.get("cache-control"));
    expect(second.response.headers.get("etag")).toBe(first.response.headers.get("etag"));
    expect(await second.response.text()).toContain("Ada</h1>");
  });

  test("answers 304 from the kept copy", async () => {
    const h = handler({ "app/page": 60 });
    const etag = (await h(new Request("https://fixture.test/")))!.headers.get("etag")!;
    const again = (await h(new Request("https://fixture.test/", { headers: { "If-None-Match": etag } })))!;

    expect(again.status).toBe(304);
    expect(again.headers.get("x-rsc-kit")).toBe("cached");
    expect(again.headers.get("cdn-cache-control")).toBe("max-age=60, stale-while-revalidate=86400, stale-if-error=86400");
  });

  test("keeps a document and each navigation payload apart", async () => {
    const h = handler({ "app/page": 60 });

    await h(new Request("https://fixture.test/"));
    const payload = (await h(navigation("/")))!;

    expect(payload.headers.get("content-type")).toContain("text/x-component");
    expect(payload.headers.get("x-rsc-kit")).toBe("rendered");
    expect((await h(navigation("/")))!.headers.get("x-rsc-kit")).toBe("cached");
  });

  test("never keeps a page it sent private", async () => {
    const h = handler({ "app/writes/page": 60 });

    await h(new Request("https://fixture.test/writes"));
    const again = (await h(new Request("https://fixture.test/writes")))!;

    expect(again.headers.get("x-rsc-kit")).toBe("rendered");
    expect(again.headers.get("cache-control")).toBe("private, no-store");
  });

  test("renders once for a burst of requests nobody has kept yet", async () => {
    const one = await calls(handler({ "app/page": 60 }), () => new Request("https://fixture.test/"));
    const h = handler({ "app/page": 60 });

    calledAs = [];
    const answers = await Promise.all(Array.from({ length: 10 }, () => h(new Request("https://fixture.test/"))));

    expect(calledAs.length).toBe(one.calls);
    expect(answers.filter((a) => a!.headers.get("x-rsc-kit") === "cached").length).toBe(9);
  });

  test("past revalidate, sends the stale copy at once and renders the next one behind it", async () => {
    const h = handler({ "app/page": 60 });
    const start = Date.now();

    await h(new Request("https://fixture.test/"));

    try {
      setSystemTime(new Date(start + 61_000));
      calledAs = [];

      const stale = (await h(new Request("https://fixture.test/")))!;

      expect(stale.headers.get("x-rsc-kit")).toBe("cached");
      expect(Number(stale.headers.get("age"))).toBeGreaterThanOrEqual(60);

      // The render behind it: wait for the backend calls it makes, then the
      // next visitor gets the new copy.
      for (let i = 0; i < 100 && (await h(new Request("https://fixture.test/")))!.headers.get("age") !== "0"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(calledAs.length).toBeGreaterThan(0);
      expect((await h(new Request("https://fixture.test/")))!.headers.get("age")).toBe("0");
    } finally {
      setSystemTime();
    }
  });

  test("is off when told, and where Homeport's edge keeps pages", async () => {
    const off = createRscHandler({
      engine: { ...engine, manifest: engine.manifest },
      manifest: { ...manifest, routes: manifest.routes.map((route: any) => ({ ...route, revalidate: route.component === "app/page" ? 60 : undefined })) },
      pageCache: false,
    } as never);

    await off(new Request("https://fixture.test/"));
    expect((await off(new Request("https://fixture.test/")))!.headers.get("x-rsc-kit")).toBe("rendered");

    process.env.HOMEPORT_PURGE_URL = "http://127.0.0.1:1/purge";

    try {
      const h = handler({ "app/page": 60 });

      await h(new Request("https://fixture.test/"));
      expect((await h(new Request("https://fixture.test/")))!.headers.get("x-rsc-kit")).toBe("rendered");
    } finally {
      delete process.env.HOMEPORT_PURGE_URL;
    }
  });
});

describe("a kept page and its tags", () => {
  // Versions this process keeps, so a test can say a tag changed; the
  // fixture's backend keeps its own, which only the backend can move.
  beforeAll(() => installVersionSource(memoryVersions()));
  afterAll(() => installVersionSource(null));

  const post = cache(async (id: number) => ({ id }), { key: "test.kept-post", revalidate: 60, tags: (id) => ["kept-posts", `kept-post:${id}`] });
  const entry = () => ({ revalidate: 60, path: "/posts/1", refused: null });

  /** Render /posts/1 as a revalidate page would, reading post 1, and keep it. */
  const renderAndKeep = async (pages: ReturnType<typeof createPageCache>, between?: () => Promise<void>) => {
    const request = new Request("https://fixture.test/posts/1");
    const answer = await withRequest(request, async () => {
      renderAsNobody();
      await post(1);
      await between?.();

      return finishCacheable(request, new Response("<h1>Post</h1>", { headers: { "Content-Type": "text/html" } }), entry());
    });

    await pages.keep("k", answer);
  };

  test("is served until one of its tags changes, then rendered again", async () => {
    const pages = createPageCache(pageMemoryStore());

    await renderAndKeep(pages);
    expect(await pages.lookup("k", new Request("https://fixture.test/posts/1"))).not.toBeNull();

    await versionSource().bump(["kept-post:2"]);
    expect(await pages.lookup("k", new Request("https://fixture.test/posts/1"))).not.toBeNull();

    await versionSource().bump(["kept-post:1"]);
    expect(await pages.lookup("k", new Request("https://fixture.test/posts/1"))).toBeNull();
  });

  test("rendered while its tag changed, is kept but never served", async () => {
    const pages = createPageCache(pageMemoryStore());

    await renderAndKeep(pages, async () => {
      await versionSource().bump(["kept-posts"]);
    });

    expect(await pages.lookup("k", new Request("https://fixture.test/posts/1"))).toBeNull();
  });

  test("past revalidate, is served stale for the same window a CDN is given, then rendered", async () => {
    const pages = createPageCache(pageMemoryStore());
    const request = () => new Request("https://fixture.test/posts/1");

    await renderAndKeep(pages);
    expect((await pages.lookup("k", request()))!.stale).toBe(false);

    const start = Date.now();

    try {
      setSystemTime(new Date(start + 61_000));
      expect((await pages.lookup("k", request()))!.stale).toBe(true);

      setSystemTime(new Date(start + (60 + 86_400) * 1000));
      expect(await pages.lookup("k", request())).toBeNull();
    } finally {
      setSystemTime();
    }
  });

  test("whose tag changed is never served stale", async () => {
    const pages = createPageCache(pageMemoryStore());
    const start = Date.now();

    await renderAndKeep(pages);
    await versionSource().bump(["kept-posts"]);

    try {
      setSystemTime(new Date(start + 61_000));
      expect(await pages.lookup("k", new Request("https://fixture.test/posts/1"))).toBeNull();
    } finally {
      setSystemTime();
    }
  });

  test("in memory, holds no more than its byte budget", () => {
    const store = pageMemoryStore(10);

    store.set("a", "12345", 60);
    store.set("b", "12345", 60);
    store.set("c", "12345", 60);
    store.set("huge", "x".repeat(11), 60);

    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toBe("12345");
    expect(store.get("c")).toBe("12345");
    expect(store.get("huge")).toBeUndefined();
  });
});
