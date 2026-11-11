import { describe, expect, test } from "bun:test";
import { samePageUrl } from "../../src/vite";

const page = (component: string, segments: { type: "static" | "param" | "catchAll" | "host"; value: string }[]) => ({ component, segments });

describe("two pages at one url", () => {
  test("a route group inside another is still the url its pages are at", () => {
    const said = samePageUrl([page("app/(home)/page", []), page("app/(preview)/(home)/page", [])]);

    expect(said).toContain("app/(home)/page and app/(preview)/(home)/page are both the page at /");
  });

  test("a parameter's name does not make a different url", () => {
    const said = samePageUrl([
      page("app/posts/[id]/page", [{ type: "static", value: "posts" }, { type: "param", value: "id" }]),
      page("app/(blog)/posts/[slug]/page", [{ type: "static", value: "posts" }, { type: "param", value: "slug" }]),
    ]);

    expect(said).toContain("both the page at /posts/[slug]");
  });

  test("different urls, a parameter beside a static segment, and a catch-all beside a parameter are fine", () => {
    expect(
      samePageUrl([
        page("app/(home)/page", []),
        page("app/(preview)/home/page", [{ type: "static", value: "home" }]),
        page("app/posts/new/page", [{ type: "static", value: "posts" }, { type: "static", value: "new" }]),
        page("app/posts/[id]/page", [{ type: "static", value: "posts" }, { type: "param", value: "id" }]),
        page("app/posts/[...rest]/page", [{ type: "static", value: "posts" }, { type: "catchAll", value: "rest" }]),
      ]),
    ).toBeNull();
  });
});
