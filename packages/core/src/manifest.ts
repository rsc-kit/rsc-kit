// The shape of routes.json — what the build discovered, for a host to read.
//
// The build already walks app/ to generate its entries, and every host needs
// the same facts: which url a component answers, what layouts wrap it, which
// slots and sections belong to it. Laravel used to scan the tree a second time
// to work that out; a JS host would have had to write a third walk. This is the
// one answer, and these are its types.
//
// Urls are segments rather than a pattern string, because the pattern is the
// host's dialect: Laravel writes {slug}, Hono writes :slug, and neither is the
// build's business.

export interface RouteSegment {
  /**
   * `host`: a `[name]` directory at the top of app/. Bound from the request's
   * host, never from a path segment - so `example.com/nope` is a 404 rather
   * than a tenant called "nope". See hostRouting.
   */
  type: "static" | "param" | "catchAll" | "host";
  value: string;
}

export interface ManifestRoute {
  component: string;
  segments: RouteSegment[];
  layouts: string[];
  loadings: string[];
  /**
   * `error.tsx` files above this route, outermost first.
   *
   * The nearest one to a failure catches it, the same way the nearest
   * `loading.tsx` is the fallback. Optional: a manifest from a build before
   * error boundaries existed has none.
   */
  errors?: string[];
  /**
   * `middleware.ts` files above this route, outermost first.
   *
   * Run before anything at or below them renders, on every path. A check is
   * not UI, and making it a layout meant the client could decline it: layouts
   * are skipped on a partial navigation, and what gets skipped is named in a
   * header nothing can verify.
   */
  middleware: string[];
  slots: Record<string, string>;
  sections: string[];
  /**
   * The host's route-config file beside this page, if it named one, and the
   * ancestor ones that also apply — outermost first, this page's excluded.
   *
   * Relative to the project root: an absolute path is true only on the machine
   * that produced it, and building in a container is ordinary.
   */
  config: string | null;
  ancestorConfigs: string[];
  /**
   * Host middleware names for this route, outermost first.
   *
   * Declared in a route.ts beside or above the page. The engine does not know
   * what they mean — they are the host's own vocabulary — it only runs them
   * past the host before anything at or below this route renders.
   *
   * Empty on a route that named none, and on every route in an app that never
   * wrote a route.ts, which is why this needs no flag.
   *
   * Optional because registration boots from the PREVIOUS build's manifest: a
   * shape change takes two builds to settle, and a required field would make
   * the first of those a hard failure rather than a route with no guards.
   */
  hostMiddleware?: string[];
  /**
   * Whether the page exports generateStaticParams.
   *
   * Recorded here so a host can plan a build — which routes to ask for urls,
   * which to leave on demand — without loading the server bundle first. The
   * function itself is reached through the bundle's getStaticParams(), because
   * only the bundle can run it.
   */
  staticParams: boolean;
}

export interface ManifestIntercept {
  component: string;
  slot: string;
  segments: RouteSegment[];
  /** (.) same level, (..) one up, (...) from the root. */
  marker: string;
}

/**
 * A `route.ts` — an api endpoint rather than a page.
 *
 * Separate from `routes` because it is matched before them and answered
 * without rendering anything: no layouts, no payload, no client. A url cannot
 * be both, and the build refuses one that is.
 */
export interface ManifestApiRoute {
  /** The module name, as the engine's registry keys it. */
  name: string;
  /**
   * The file that answers, relative to the source directory - `app/api/x/route.ts`,
   * or `app/sitemap.ts` for a route the build synthesised from a metadata file
   * - so a line about the route can say where to look.
   */
  source?: string;
  segments: RouteSegment[];
  /** Which methods the file exports, so a 405 can name the rest. */
  methods: string[];
  /**
   * `middleware.ts` files above this route, outermost first.
   *
   * The same chain a page in that directory runs. A route.ts sits among the
   * pages it belongs with, so a guard on the directory covers it too —
   * anything else would mean adding an endpoint under a guarded path silently
   * opened a hole in it.
   */
  middleware: string[];
}

export interface RouteManifest {
  version: number;
  build: {
    output: string;
    exportPath: string;
    payloadName: string;
    /**
     * The site's own hosts, bare and lower-case. A request from any other
     * host is matched with that host's segment in front of its path - see
     * hostRouting. Absent or empty: every request is the site's own.
     */
    hosts?: string[];
    /**
     * Whether every response says what built it: `X-Powered-By: rsc-kit` and
     * a generator meta tag in the document. The name only, never the version.
     * `X-RSC-Kit` (how a response was served) is sent regardless.
     */
    identify?: boolean;
  };
  routes: ManifestRoute[];
  intercepts: ManifestIntercept[];
  /** Optional: a manifest from a build before api routes existed has none. */
  apis?: ManifestApiRoute[];
}
