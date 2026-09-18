import { describe, expect, test } from "bun:test";
import { matchApiRoute, matchRoute } from "../../src/routing";
import type {
  ManifestRoute,
  RouteManifest,
  RouteSegment,
} from "../../src/manifest";

const seg = (pattern: string): RouteSegment[] =>
  pattern
    .split("/")
    .filter(Boolean)
    .map((s) =>
      s.startsWith("[...")
        ? { type: "catchAll", value: s.slice(4, -1) }
        : s.startsWith("[")
          ? { type: "param", value: s.slice(1, -1) }
          : { type: "static", value: s },
    );

const route = (pattern: string): ManifestRoute =>
  ({
    component: `app${pattern === "/" ? "" : pattern}/page`,
    segments: seg(pattern),
    layouts: [],
    loadings: [],
    middleware: [],
    slots: {},
    sections: [],
    config: null,
    ancestorConfigs: [],
    staticParams: false,
  }) as never;

const manifest = (...patterns: string[]): RouteManifest =>
  ({
    version: 1,
    build: { output: "server", exportPath: "dist", payloadName: "" },
    routes: patterns.map(route),
    apis: [
      {
        ...route("/api/health"),
        name: "app/api/health/route",
        methods: ["GET"],
      },
      {
        ...route("/api/items/[id]"),
        name: "app/api/items/[id]/route",
        methods: ["GET"],
      },
    ],
    intercepts: [],
  }) as never;

describe("matching a url to a route", () => {
  const m = manifest(
    "/",
    "/posts",
    "/posts/[slug]",
    "/docs/[...path]",
    "/posts/new",
  );

  test("a fully static path is answered without scoring anything", () => {
    // The map is the fast path; these are the requests most apps mostly get.
    expect(matchRoute(m, "/posts")?.route.component).toBe("app/posts/page");
    expect(matchRoute(m, "/posts/")?.route.component).toBe("app/posts/page");
    expect(matchRoute(m, "/")?.route.component).toBe("app/page");
  });

  test("a static route beats a param on the same path, however they are ordered", () => {
    expect(matchRoute(m, "/posts/new")?.route.component).toBe(
      "app/posts/new/page",
    );
    expect(matchRoute(m, "/posts/hello")).toMatchObject({
      params: { slug: "hello" },
    });
  });

  test("a catch-all is the weakest match and binds the rest", () => {
    expect(matchRoute(m, "/docs/a/b/c")).toMatchObject({
      params: { path: "a/b/c" },
    });
    expect(matchRoute(m, "/nothing/here")).toBeNull();
  });

  test("the index is per manifest object, so a swapped manifest is not answered from the old one", () => {
    const other = manifest("/only");

    expect(matchRoute(other, "/posts")).toBeNull();
    expect(matchRoute(other, "/only")?.route.component).toBe("app/only/page");
    expect(matchRoute(m, "/posts")?.route.component).toBe("app/posts/page");
  });

  test("api routes take the same two paths", () => {
    expect(matchApiRoute(m, "/api/health")?.route.name).toBe(
      "app/api/health/route",
    );
    expect(matchApiRoute(m, "/api/items/42")).toMatchObject({
      params: { id: "42" },
    });
    expect(matchApiRoute(m, "/api/nope")).toBeNull();
  });
});

describe("a host segment", () => {
  const manifest = {
    routes: [
      { component: "app/page", segments: [], layouts: [] },
      {
        component: "app/admin/page",
        segments: [{ type: "static", value: "admin" }],
        layouts: [],
      },
      {
        component: "app/[domain]/page",
        segments: [{ type: "host", value: "domain" }],
        layouts: [],
      },
      {
        component: "app/[domain]/settings/page",
        segments: [
          { type: "host", value: "domain" },
          { type: "static", value: "settings" },
        ],
        layouts: [],
      },
    ],
    intercepts: [],
  } as never;

  test("binds the leading part when it came from the host", () => {
    expect(matchRoute(manifest, "/acme", "acme")?.params).toEqual({
      domain: "acme",
    });
    expect(
      matchRoute(manifest, "/acme.com/settings", "acme.com"),
    ).toMatchObject({
      route: { component: "app/[domain]/settings/page" },
      params: { domain: "acme.com" },
    });
  });

  test("and never from a path: example.com/nope is not a tenant called nope", () => {
    expect(matchRoute(manifest, "/nope")).toBeNull();
    expect(matchRoute(manifest, "/nope/settings")).toBeNull();
  });

  test("a directory named for the host wins over it", () => {
    expect(matchRoute(manifest, "/admin", "admin")?.route.component).toBe(
      "app/admin/page",
    );
    expect(matchRoute(manifest, "/admin")?.route.component).toBe(
      "app/admin/page",
    );
  });
});
