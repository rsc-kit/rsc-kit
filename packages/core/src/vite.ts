// File-based routing for React Server Components, as a Vite plugin.
//
// Host-agnostic by design: it discovers an app/ route tree, generates the three
// entries, and exposes a render contract over a global the host installs. What
// that global is called, and how a route declares dynamic props, are options —
// nothing here knows or cares which backend is driving it.
//
//   import { rscKit } from '<package>/vite'
//   export default defineConfig({ plugins: [rscKit(), react({ compiler: true })] })
//
// The plugin discovers the app/ route tree, generates the three entries that
// carry the route composition and the worker's render contract, and supplies
// the structural config (entries, output dirs, base). @vitejs/plugin-rsc is
// included here so it always runs before any react() layer the app adds.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  createReadStream,
} from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import rsc, { getPluginApi } from "@vitejs/plugin-rsc";
import { loadEnv } from "vite";
import type { PrerenderResult } from "./prerender.js";
import { REPORT_FILE, buildReport } from "./buildReport.js";
import { MANIFEST_PATH, manifestWarning, webManifest } from "./webManifest.js";
import {
  ASSET_BASE,
  allAppAssets,
  appAssets,
  headTags,
  typeOf,
} from "./appAssets.js";
import { reactCacheImports } from "./reactCache.js";
import {
  clientEntries,
  clientScanPlugin,
  engineClientEntries,
} from "./clientEntries.js";
import { serverImportsOfClientPackages } from "./clientImports.js";
import {
  serverRendererMessage,
  SERVER_RENDERER,
  ssrProxyModule,
  UseSsrError,
} from "./useSsr.js";
import type { ClientLibraryImport } from "./clientImports.js";
import type { AppAssets } from "./appAssets.js";
import type { WebManifestOptions } from "./webManifest.js";
import type { Plugin, PluginOption, ResolvedConfig } from "vite";
import { httpHostCalls } from "./hostCalls.js";
import type {
  ManifestIntercept,
  ManifestRoute,
  RouteManifest,
  RouteSegment,
} from "./manifest.js";

export interface RscKitOptions {
  /** Project root. Defaults to RSC_PROJECT_ROOT, then cwd. */
  projectRoot?: string;
  /** Directory holding the app/ route tree. Defaults to `src`. */
  sourceDir?: string;
  /**
   * Serve the app from a service worker, so it survives a reload with no
   * network at all.
   *
   * Everything else this engine keeps — held pages, the prefetch cache — lives
   * in one page's memory. Reload with no network and the browser shows its own
   * error page: no script runs, so nothing cached in JavaScript is reachable.
   * A worker is the only thing on the other side of that line.
   *
   * Off by default. It changes what a visitor sees when your deploy is broken,
   * which is not a decision to make for someone.
   */
  offline?: boolean;
  /**
   * Whether a page stored without the runtime gets its stylesheet inlined
   * into the document, so the first paint waits on no request but the
   * document itself.
   *
   *   'auto'   inline when the sheet is at most 10 kB gzipped (the default)
   *   false    never - keep the link, and let the browser cache one file
   *            across every page; the choice for a site of many small pages
   *   true     always, whatever the size
   *   number   your own cap, in gzipped bytes
   *
   * Only for a page with no runtime. One with React on it keeps its link
   * regardless, because React expects to find it in the DOM to hydrate.
   */
  inlineStylesheets?: "auto" | boolean | number;
  /**
   * Run the project's own typecheck as part of `vite build`, and fail the
   * build on an error. On by default when the project has a `tsconfig.json`
   * and `typescript` installed; `false` turns it off.
   *
   * A build that bundles a `<Link href="/nowhere">` and stores every page
   * has produced a broken site that looks finished. The route types exist so
   * that link is an error - but Vite never typechecks, so the error only
   * showed for whoever ran `tsc` separately. `next build` typechecks for the
   * same reason.
   */
  typecheck?: boolean;
  /**
   * The most a server action body may be, in bytes. 8 MB unless set.
   *
   * Arguments and uploaded files arrive in one body, read whole before the
   * action runs; over this the answer is 413 before a byte is kept. Raise it
   * for an app that uploads larger files through actions.
   */
  maxActionBody?: number;
  /** Where the server bundles and generated entries go. Defaults to `.rsc`. */
  outDir?: string;
  /**
   * A file the dev server writes its own url into, and removes on shutdown.
   *
   * Laravel's convention, and the reason it is worth adopting: a dev server
   * picks its port at runtime — 5173 is the most contended port on a developer's
   * machine, and Vite silently moves to the next free one — so anything holding
   * a fixed url is wrong the moment a second project is running. A backend that
   * reads this file follows the server instead of guessing at it.
   */
  hotFile?: string;
  /**
   * Where `rpc()` goes while `vite dev` is serving.
   *
   * A built deployment installs this itself — the server that runs
   * createRscHandler passes `hostCalls`. The dev server has no such server in
   * front of it, so without this every rpc() during development is refused and
   * any page whose data comes from the backend renders blank.
   *
   * Both halves default to the app's own .env, which for a Laravel app already
   * has them: APP_URL for the backend and RSC_HOST_CALL_SECRET for the secret.
   * That is the difference between "configure the dev server" and "it works".
   */
  hostCall?: { endpoint?: string; secret?: string; path?: string };

  /**
   * Where the dev server hands a url it does not own.
   *
   * The route tree is only part of an application: /login, a Blade page, a
   * webhook and an uploaded file under /storage all belong to the backend. So
   * in development this origin is the whole app rather than the RSC half of
   * it, and a browser can sit on it instead of on a proxy in front of it.
   *
   * Defaults to the same place host calls go — RSC_BACKEND, then APP_URL —
   * because a second setting that could disagree with the first is a bug
   * waiting to be filed. `false` restores the plain 404.
   *
   * Development only. A built deployment's server.ts decides for itself what
   * to do with a url it does not own.
   */
  devFallback?: string | false;

  /**
   * This package's directory, holding the client runtime the browser entry
   * imports. Vite stages configs through node_modules/.vite-temp, so
   * import.meta.dir is not this file's real location by the time the plugin
   * runs — a host invoking the build out of process passes the real path
   * through RSC_PACKAGE_DIR.
   */
  packageDir?: string;
  /**
   * Name of the global the host installs for calling its own functions from a
   * server component — `await rpc('getUser', id)`. The mechanism is
   * host-agnostic; only the name is a convention, so a host that prefers
   * something else can say so.
   */
  hostGlobal?: string;
  /**
   * JSON file of `{urlPattern, slot}` entries naming the routes the client
   * router should intercept rather than navigate to. Written by the host,
   * which owns route discovery.
   */
  interceptManifestFile?: string;
  /**
   * Bare-specifier prefix for importing the client runtime, as in
   * `import Link from '<prefix>/Link'`, aliased to this package's js/
   * directory.
   *
   * Only needed when this package is not resolvable from the project's
   * node_modules — a host that vendors it through its own package manager,
   * say. Installed from npm, the package name resolves on its own and no
   * alias is required.
   */
  packageAlias?: string;
  /**
   * Origin the Vite dev server is reachable at, e.g. `http://localhost:5173`.
   *
   * Set only when running under the dev server. @vitejs/plugin-rsc emits its
   * bootstrap and CSS links root-relative in dev and no Vite setting moves
   * them, so with the host serving the page the browser would ask the host for
   * modules only Vite can answer. Given this, the SSR entry rewrites them onto
   * the dev origin — see devUrls.ts. Empty in a build, where the URLs are real
   * built assets.
   */
  devOrigin?: string;
  /**
   * What the build produces.
   *
   *   'server'  the default: pages are served by a host, and a payload is
   *             asked for with a header on the page's own url.
   *   'export'  files any static host can serve. Payloads get addresses of
   *             their own, because a host serving files cannot act on a
   *             header, and the client is built to ask for those instead.
   */
  output?: "server" | "export";
  /** Where an exported site is written, relative to the project root. */
  exportPath?: string;
  /**
   * Filename payloads are served under on a static host, e.g. `index.rsc`.
   *
   * Only for an exported build. Normally the payload shares the page's url and
   * is asked for with a header; a host that serves files cannot answer that,
   * so the payload needs an address of its own.
   */
  staticPayloads?: string;
  /**
   * How to tell that a route's props are resolved dynamically by the host, so
   * the page cannot be prerendered whole.
   *
   * Entirely host-defined: a host that writes a config file beside the page
   * names that file and the pattern that marks it dynamic. Omitted, no page is
   * classified dynamic on this basis.
   */
  routeConfig?: { file: string; dynamicPattern: RegExp };
  /**
   * Functions the host exposes to the app, as `{ exportedName: target }`.
   *
   * The build writes a "use server" module of stubs for these, each one
   * calling the host global with its target — so app code imports an ordinary
   * async function and never names the transport. Discovery belongs to the
   * host, whose functions these are; only the rendering is here, because the
   * module has to land beside the app's source and that path is the build's.
   *
   * A host whose functions are already JavaScript passes nothing.
   */
  hostActions?: Record<string, string>;
}

// Resolved once per rscKit() call. One build runs in one process, so these are
// module state rather than threaded through every helper.
let projectRoot: string;
let sourceDir: string;
let inlineStylesheets: "auto" | boolean | number = "auto";
let resolvedConfig: ResolvedConfig | null = null;

/** Server files importing a client library, read off the rsc graph when it is built. */
let clientLibraryImports: ClientLibraryImport[] = [];

/** Modules a runtime provides and no bundle should try to carry. */
const RUNTIME_BUILTINS = ["bun", /^bun:/];

function arrayOf<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

/**
 * What a client chunk is called on disk.
 *
 * A "use server" module reaches the browser as a proxy - one stub per export
 * that calls the action by id - and the proxy keeps the file's identity, so
 * the bundler can name a chunk after it. When shared client code is merged
 * into that chunk the output has a file called `auth-actions-…js` in
 * public/assets: fifty kilobytes of UI components with the name of the
 * server file, which reads as a leak to anyone who looks. Nothing leaked -
 * the proxy holds ids, never bodies - but a name that says otherwise is a
 * bug. Such a chunk is called what it is.
 */
function clientChunkFileName(chunk: {
  name: string;
  facadeModuleId: string | null;
  moduleIds: string[];
}): string {
  const table = resolvedConfig
    ? getPluginApi(resolvedConfig)?.manager?.serverReferences?.metaMap
    : undefined;

  if (table && table.size > 0) {
    const bare = (id: string) => {
      const file = id.split("?")[0]!.split("/").pop() ?? "";

      return file.replace(/\.[^.]+$/, "");
    };
    const serverModules = new Set([...table.keys()].map(bare));
    const namedAfterServerModule =
      (chunk.facadeModuleId !== null &&
        serverModules.has(bare(chunk.facadeModuleId))) ||
      (serverModules.has(chunk.name) &&
        chunk.moduleIds.some((id) => bare(id) === chunk.name));

    if (namedAfterServerModule) return "assets/client-[hash].js";
  }

  return "assets/[name]-[hash].js";
}
let maxActionBody: number | undefined;
let outDir: string;
let appDir: string;
let genDir: string;
let publicAssetsDir: string;
/** Where generated ambient declarations go — `.rsc-kit` at the project root. */
let typesDir: string;
let hotFile: string;
let hostCallOptions: RscKitOptions["hostCall"];
let packageDir: string;
let hostGlobal: string;
let interceptManifestFile: string;
let packageAlias: string | null;
/** Dev-server origin; empty in a build. See devUrls.ts. */
let devOrigin: string;
/** 'server' or 'export' — see RscKitOptions.output. */
let output: string;
/** Where an exported site is written. */
let exportPath: string;
/**
 * Filename payloads are exported under, empty unless building for a static
 * host. Set, the client asks `<page>/<name>` for a payload instead of asking
 * for the page's own url with a header a static host cannot act on.
 */
let staticPayloads: string;
let routeConfig: { file: string; dynamicPattern: RegExp } | null;
/** Whether `vite build` freezes pages when it finishes — see RscKitOptions. */
let prerenderAfterBuild: boolean;
/** True during `vite build --watch`, where re-rendering every route is noise. */
let isWatch = false;
/** Whether a service worker is generated and registered — see options. */
let offline = false;
let typecheck = true;
let webManifestOptions: WebManifestOptions | null = null;
let foundAssets: AppAssets = {
  favicon: null,
  icons: [],
  appleIcon: null,
  openGraph: null,
  twitter: null,
};
/** Host functions to generate stubs for — see RscKitOptions.hostActions. */
let hostActions: Record<string, string>;

/**
 * This file's directory.
 *
 * Not `import.meta.dir`, which is Bun-only: Vite bundles the config and runs it
 * under Node, where that is undefined and the path resolution below throws
 * before the build starts. Reached whenever RSC_PACKAGE_DIR is unset — which is
 * the ordinary case for an app that installs the engine from npm and runs
 * `vite build` itself.
 */
/** This package's name, for excluding it from dep optimization. */
const PACKAGE_NAME: string = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf-8",
      ),
    ) as { name?: string };

    return manifest.name ?? "@rsc-kit/core";
  } catch {
    return "@rsc-kit/core";
  }
})();

function thisDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** routeConfig supplied through the environment, for out-of-process hosts. */
function envRouteConfig(): { file: string; dynamicPattern: RegExp } | null {
  const file = process.env.RSC_ROUTE_CONFIG_FILE;
  const pattern = process.env.RSC_ROUTE_CONFIG_PATTERN;

  if (!file || !pattern) return null;

  return { file, dynamicPattern: new RegExp(pattern) };
}

/** The file a backend writes its action names into. */
const HOST_ACTIONS_FILE = "rsc-host-actions.json";

/**
 * Host actions, read from a file the backend wrote.
 *
 * A file rather than an environment variable, because the backend no longer
 * drives the build — `vite build` does. Discovery has to stay where the classes
 * are (reflection through Composer's autoloader finds what a class inherits;
 * a regex would silently miss every inherited action), but the handoff is just
 * a map of names, and a JSON file is something any language can write:
 *
 *     php artisan rsc:action-manifest > rsc-host-actions.json
 *     go run ./cmd/rsc-actions       > rsc-host-actions.json
 *
 * Absent is not an error. An app with no host actions has no file, and one
 * that has them regenerates it as part of its build.
 */
function fileHostActions(root: string): Record<string, string> {
  const path = join(root, HOST_ACTIONS_FILE);

  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error('expected an object of { jsName: "Class.method" }');
    }

    return parsed as Record<string, string>;
  } catch (error) {
    // Loud, because the alternative is generating no stubs: every import of a
    // server action then fails at build time, naming the import rather than
    // this file.
    throw new Error(
      `Could not read ${HOST_ACTIONS_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The alias that lets a vendored copy of this package be imported by name.
 *
 * Only when the package is not installed, because an alias is a path rewrite
 * and rewrites nothing through the package's own exports. With both in play
 * the specifier meant two different things: `<pkg>/Form` resolved to whatever
 * file happened to sit at js/Form, rather than to what ./Form is declared to
 * mean. Installed from npm, ordinary resolution reads the exports map and the
 * two cannot drift.
 */
function aliasEntries(): Array<{ find: RegExp; replacement: string }> {
  if (!packageAlias) return [];

  if (existsSync(join(projectRoot, "node_modules", packageAlias))) return [];

  return [
    {
      find: new RegExp(
        "^" + packageAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/(.*)$",
      ),
      replacement: join(packageDir, "js") + "/$1",
    },
  ];
}

function resolvePaths(options: RscKitOptions): void {
  projectRoot = resolve(
    options.projectRoot || process.env.RSC_PROJECT_ROOT || process.cwd(),
  );
  sourceDir = resolve(
    options.sourceDir || process.env.RSC_SOURCE_DIR || join(projectRoot, "src"),
  );
  outDir = resolve(
    options.outDir || process.env.RSC_OUT_DIR || join(projectRoot, ".rsc"),
  );
  appDir = join(sourceDir, "app");

  // Generated entries live under the (in-project) out dir so module resolution
  // can walk up to the project's node_modules (@vitejs/plugin-rsc, react, ...).
  genDir = join(outDir, ".gen");

  // Not a migration guard — those are not worth carrying in a pre-release.
  // This is the silent-failure guard the rest of this file is written to be.
  //
  // Nitro publishes the assets and serves them from its own root. A prefix set
  // here would be emitted into the markup and answered by nobody: every asset
  // 404s while every page still renders, so the app arrives unstyled, never
  // hydrates, and logs nothing anywhere. Vite does not typecheck a config, so
  // removing the option from the type is not enough to stop it.
  //
  // There is deliberately no check for `nitro`. It is gone from the type, and
  // a config still passing `nitro: true` is asking for exactly what it gets.
  const removed = ["assetsDir", "assetsUrl"].filter(
    (key) => (options as Record<string, unknown>)[key] !== undefined,
  );

  if (removed.length > 0) {
    throw new Error(
      `[rsc-kit] ${removed.join(" and ")} ${removed.length === 1 ? "is" : "are"} no longer an option.\n\n` +
        "Nitro publishes the browser assets to .output/public and serves them from its own\n" +
        "root, so there is no prefix to set. That directory is the deployment — point nginx\n" +
        "or a CDN at it if something other than the app should serve them.",
    );
  }

  // Vite's own default. Nitro overrides it with .output/public, which is why
  // there is nothing here to configure.
  publicAssetsDir = resolve(join(projectRoot, "dist/client"));
  typesDir = join(projectRoot, ".rsc-kit");
  hotFile = options.hotFile || process.env.RSC_HOT_FILE || "";
  hostCallOptions = options.hostCall;
  packageDir = resolve(
    options.packageDir || process.env.RSC_PACKAGE_DIR || thisDir(),
  );
  hostGlobal = options.hostGlobal || process.env.RSC_HOST_GLOBAL || "rpc";
  interceptManifestFile = resolve(
    options.interceptManifestFile ||
      process.env.RSC_INTERCEPT_MANIFEST ||
      join(outDir, "intercept-manifest.json"),
  );
  packageAlias = options.packageAlias || process.env.RSC_PACKAGE_ALIAS || null;
  devOrigin = options.devOrigin || process.env.RSC_DEV_ORIGIN || "";
  output = options.output || process.env.RSC_OUTPUT || "server";
  exportPath = options.exportPath || process.env.RSC_EXPORT_PATH || "dist";
  // An export decides this for itself: the client has to ask for payloads by
  // url because there is no server to read a header, and the name it asks for
  // is the one the export writes.
  staticPayloads =
    options.staticPayloads ||
    process.env.RSC_STATIC_PAYLOADS ||
    (output === "export" ? "index.rsc" : "");

  // No default: which file marks a route dynamic is the host's convention, and
  // guessing one here would bake a particular backend into a generic plugin.
  // The env pair exists so a host driving the build out of process can pass it
  // without writing a config file.
  routeConfig = options.routeConfig ?? envRouteConfig();
  // A host driving the build out of process cannot pass an option, and may
  // prerender itself afterwards with paths only it knows.
  // No public switch. A page that must not be frozen says so with
  // `await connection()`, and the build names every page that could not be
  // rendered - the same model Next has with cache components, where the
  // only opt-out is per page. RSC_PRERENDER=0 remains, internal: watch mode
  // sets it, and so does a host that drives the build out of process and
  // prerenders itself afterwards with paths only it knows.
  prerenderAfterBuild = process.env.RSC_PRERENDER !== "0";
  offline = options.offline === true;
  typecheck = options.typecheck !== false;
  inlineStylesheets = options.inlineStylesheets ?? "auto";
  maxActionBody = options.maxActionBody;
  // One place, and it is the file. A plugin option as well would be the same
  // thing sayable in two places, which is the problem the file was moved to
  // solve rather than a convenience to keep beside it.
  webManifestOptions = declaredManifest(join(sourceDir, "app"));
  foundAssets = appAssets(join(sourceDir, "app"));

  // An app that put icons where they could be found has already listed them.
  // Writing them again in the manifest is the same set in two places, and the
  // one that goes stale is the one nobody looks at.
  if (
    webManifestOptions &&
    !webManifestOptions.icons?.length &&
    foundAssets.icons.length
  ) {
    webManifestOptions = {
      ...webManifestOptions,
      icons: foundAssets.icons.map((icon) => icon.href),
    };
  }
  hostActions = options.hostActions ?? fileHostActions(projectRoot);
}

interface Component {
  name: string; // route-relative key, e.g. "app/page", "app/layout"
  absPath: string;
  alias: string; // safe JS identifier for the generated import
}

function log(...args: unknown[]): void {
  console.error("[rsc-kit]", ...args);
}

// ── The route manifest ───────────────────────────────────────────────────────

/**
 * What the plugin knows about the route tree, written out for a host to read.
 *
 * The plugin already walks app/ to generate the entries, and every host has to
 * know the same things — which url a component answers, what layouts wrap it,
 * which slots and sections belong to it. Laravel scans the tree a second time
 * to work that out; a JS host would have to write a third. This is the one
 * answer, emitted where both can read it.
 *
 * Urls are expressed as segments rather than as a pattern string, because the
 * pattern is the host's dialect: Laravel writes {slug}, Hono writes :slug, and
 * neither is the plugin's business.
 */

/** `[...path]` → catchAll, `[id]` → param, `(group)` → nothing at all. */
function urlSegments(componentName: string): RouteSegment[] {
  const parts = componentName.split("/").slice(1, -1);
  const segments: RouteSegment[] = [];

  for (const part of parts) {
    // A route group organises files without appearing in the url.
    if (part.startsWith("(") && part.endsWith(")")) continue;
    // A slot directory is not part of its page's url either.
    if (part.startsWith("@")) continue;

    if (part.startsWith("[...") && part.endsWith("]")) {
      segments.push({ type: "catchAll", value: part.slice(4, -1) });
      continue;
    }

    if (part.startsWith("[") && part.endsWith("]")) {
      segments.push({ type: "param", value: part.slice(1, -1) });
      continue;
    }

    // An interception marker says which url this replaces, not what it is
    // called: (.)photo intercepts the sibling /photo. Left in place the
    // manifest would claim a route at /(.)photo, which nothing can navigate to.
    segments.push({ type: "static", value: part.replace(/^\(\.{1,3}\)/, "") });
  }

  return segments;
}

/** Whether a component sits under an interception marker: (.) (..) (...) */
function isIntercept(componentName: string): boolean {
  return componentName.split("/").some((part) => /^\(\.{1,3}\)/.test(part));
}

/** The slot directory a component lives under, if any. */
function slotOf(componentName: string): string | null {
  const part = componentName.split("/").find((p) => p.startsWith("@"));

  return part ? part.slice(1) : null;
}

/**
 * Everything the plugin discovered, as a host needs it.
 *
 * Ancestry is by path prefix: a layout at app/docs applies to everything under
 * app/docs, which is the same rule the composition uses.
 */
function routeManifest(): RouteManifest {
  const names = [...components.keys()];
  const dirOf = (name: string) => name.split("/").slice(0, -1).join("/");

  // By path, not by string: 'app/slow3' begins with 'app/slow' as text and is
  // not inside it, which would hand /slow3 the loading state of /slow.
  const isUnder = (dir: string, ancestor: string) =>
    dir === ancestor || dir.startsWith(ancestor + "/");

  const ancestors = (name: string, base: string) =>
    names
      .filter(
        (n) =>
          n.endsWith("/" + base) &&
          !isIntercept(n) &&
          isUnder(dirOf(name), dirOf(n)),
      )
      .sort((a, b) => a.length - b.length);

  /** Project-root-relative, posix — the same string on every machine. */
  const fromRoot = (abs: string) =>
    relative(projectRoot, abs).replace(/\\/g, "/");

  /** The host's config file in a directory, if the host named one and it exists. */
  const configIn = (absDir: string): string | null => {
    if (!routeConfig) return null;

    const path = join(absDir, routeConfig.file);

    return existsSync(path) ? fromRoot(path) : null;
  };

  /** Ancestor configs, outermost first, excluding the page's own directory. */
  const ancestorConfigs = (dir: string): string[] => {
    const found: string[] = [];
    const parts = dir.split("/").slice(0, -1);

    while (parts.length > 0) {
      const path = configIn(join(sourceDir, parts.join("/")));

      if (path) found.unshift(path);

      parts.pop();
    }

    return found;
  };

  /**
   * Host middleware named by a route.ts beside or above a page.
   *
   *     // app/admin/route.ts
   *     export const middleware = ['auth', 'can:update,post']
   *
   * Read statically rather than imported, for the same reason
   * generateStaticParams is detected by reading the source: this runs while the
   * manifest is being built, before there is a bundle to execute.
   *
   * The names mean nothing here. They are the host's vocabulary — Laravel
   * middleware aliases, a Go router's names — and the engine only carries them
   * to whoever knows what they mean.
   */
  const middlewareIn = (absDir: string): string[] => {
    for (const file of ["route.ts", "route.tsx"]) {
      const path = join(absDir, file);

      if (!existsSync(path)) continue;

      const match = readFileSync(path, "utf-8").match(
        /export\s+const\s+middleware\s*(?::[^=]+)?=\s*\[([^\]]*)\]/,
      );

      if (!match) continue;

      // Each quoted literal, rather than splitting the list on commas: a
      // middleware name carries its arguments after a colon and those are
      // comma-separated too, so splitting turns 'throttle:60,1' into a
      // throttle of 60 and a middleware called 1.
      return [...match[1].matchAll(/['"`]([^'"`]*)['"`]/g)]
        .map((quoted) => quoted[1].trim())
        .filter(Boolean);
    }

    return [];
  };

  /**
   * Every host middleware above and on a page, outermost first.
   *
   * Order is the whole of it: an outer guard has to run before an inner one, or
   * a check deciding whether the inner check is even reachable runs second.
   * Duplicates are dropped, so a name repeated down the tree runs once, at the
   * outermost point it was asked for.
   */
  const hostMiddleware = (dir: string): string[] => {
    const parts = dir.split("/").filter(Boolean);
    const found: string[] = [];

    for (let depth = 0; depth <= parts.length; depth++) {
      for (const name of middlewareIn(
        join(sourceDir, ...parts.slice(0, depth)),
      )) {
        if (!found.includes(name)) found.push(name);
      }
    }

    return found;
  };

  const routes: ManifestRoute[] = [];
  const intercepts: ManifestIntercept[] = [];

  for (const name of names) {
    if (name.endsWith("/page") && isIntercept(name)) {
      const slot = slotOf(name);

      if (slot) {
        const marker =
          name
            .split("/")
            .find((p) => /^\(\.{1,3}\)/.test(p))
            ?.match(/^\(\.{1,3}\)/)?.[0] ?? "(.)";

        intercepts.push({
          component: name,
          slot,
          segments: urlSegments(name),
          marker,
        });
      }

      continue;
    }

    if (!name.endsWith("/page") || slotOf(name)) continue;

    const slots: Record<string, string> = {};

    for (const candidate of names) {
      const slot = slotOf(candidate);
      // A slot belongs to the layout in the directory that declares it, so it
      // applies to a page only if that directory is on the page's path.
      if (!slot || isIntercept(candidate) || !candidate.endsWith("/default"))
        continue;
      if (isUnder(dirOf(name), candidate.split("/@")[0]))
        slots[slot] = candidate;
    }

    routes.push({
      component: name,
      segments: urlSegments(name),
      layouts: ancestors(name, "layout").map((n) => n),
      loadings: ancestors(name, "loading").map((n) => n),
      errors: ancestors(name, "error"),
      middleware: ancestors(name, "middleware").map((n) => n),
      slots,
      sections: names.filter(
        (n) => SECTION_FILE.test(n + ".tsx") && dirOf(n) === dirOf(name),
      ),
      config: configIn(join(sourceDir, dirOf(name))),
      hostMiddleware: hostMiddleware(dirOf(name)),
      ancestorConfigs: ancestorConfigs(dirOf(name)),
      staticParams: hasStaticParams(components.get(name)!.absPath),
    });
  }

  // What the build decided, for a host that has to act on it afterwards —
  // writing the site out, and knowing which filename the client will ask for.
  return {
    version: 1,
    build: { output, exportPath, payloadName: staticPayloads },
    routes,
    intercepts,
    apis: [...apiRoutes.values()].map(({ name, methods }) => ({
      name,
      segments: urlSegments(name),
      methods,
      middleware: ancestors(name, "middleware"),
    })),
  };
}

/**
 * Say so when the typechecker cannot see the declarations just written.
 *
 * Moving them out of the source directory buys a tidy `src/` and costs this:
 * `include` used to cover them by accident, and now it has to name `.rsc-kit`.
 * A project that does not is not broken in any way it can notice — every file
 * is written, every build passes, and `Link` quietly takes `string` again
 * instead of the route union, so a link to a page that does not exist compiles
 * and 404s in the browser.
 *
 * A guess, deliberately, and only ever a warning: `include` is one of several
 * ways a tsconfig can reach a file, `extends` can supply it, and a project
 * with no tsconfig at all is not doing this checking anyway. Wrong here costs
 * a line of output; silent costs the types.
 */
function warnIfTypesUnreachable(): void {
  const config = join(projectRoot, "tsconfig.json");

  if (!existsSync(config)) return;

  try {
    // Comments are legal in a tsconfig and JSON.parse does not take them.
    const text = readFileSync(config, "utf-8").replace(
      /\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm,
      "$1",
    );
    const include = (JSON.parse(text) as { include?: unknown }).include;

    if (!Array.isArray(include)) return;

    const covers = (what: string) =>
      include.some(
        (entry) => typeof entry === "string" && entry.includes(what),
      );

    if (!covers(".rsc-kit")) {
      log(
        `tsconfig.json does not include .rsc-kit, where the generated types are written.\n` +
          `  Add ".rsc-kit/**/*" to "include", or typed routes and rpc() fall back to string.`,
      );
    }
  } catch {
    // An unparseable tsconfig is the project's own problem, not this one's.
  }
}

// ── What the app imports ─────────────────────────────────────────────────────

/**
 * Write the modules the app's source imports but nobody writes by hand.
 *
 * Two destinations, and the difference is whether anything imports the file.
 *
 * The stubs are imported by relative path, so they have to sit in the source
 * directory — that path is the app's, and only the build knows it.
 *
 * The declarations are not imported by anything. They are ambient, which needs
 * them inside the project and nothing more, so they go in `.rsc-kit/` at the
 * root: four generated files in `src/` sat among the app's own and had to be
 * gitignored one by one, and every one of them was noise beside the pages.
 *
 * Ambient still means the typechecker has to be told the directory exists —
 * see the warning below, because a tsconfig that does not include it turns
 * every one of these into a file nobody reads.
 *
 * Rewritten on every run. The failure they prevent is invisible at build
 * time — a stale stub calls a global that has since been renamed, and only
 * the browser ever finds out.
 */
function writeHostBindings(manifest: RouteManifest): void {
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(typesDir, { recursive: true });

  // The global is installed at runtime, so nothing in app source declares it
  // and a typecheck cannot see it. Written whether or not there are actions:
  // server components call it directly too.
  writeFileSync(join(typesDir, "rsc-env.d.ts"), renderHostGlobalTypes());

  // The urls this build found, so a link to a page that does not exist fails
  // the typecheck instead of the browser.
  writeFileSync(join(typesDir, "rsc-routes.d.ts"), renderRouteTypes(manifest));

  // The bundle the host imports is generated, so nothing declares it. Written
  // here rather than left to the app: every app needs the identical file, and
  // an app-authored one goes stale — the first version named only RscEngine,
  // which typechecks a server and fails a prerender script.
  writeFileSync(join(typesDir, "rsc-engine.d.ts"), ENGINE_TYPES);

  warnIfTypesUnreachable();

  const target = join(sourceDir, "server-actions.generated.ts");

  // A host with no functions of its own leaves no file behind: kept, its
  // stubs would go on naming targets the host has stopped answering for.
  if (Object.keys(hostActions).length === 0) {
    if (existsSync(target)) rmSync(target);

    return;
  }

  writeFileSync(target, renderHostActions());
}

/**
 * The generated engine bundle, as the type its callers expect.
 *
 * Both contracts: createRscHandler serves requests, prerender() renders at
 * build time and needs three methods the first does not have. manifest() is
 * optional on both because a host may be handed an engine without one — this
 * is the generated bundle, which always exports it, and saying so is what lets
 * exportSite() be called without a guard that could never fire.
 */
const ENGINE_TYPES = `// @generated — do not edit. Written by the RSC build.
declare module '*/dist/rsc/index.js' {
  import type { RscEngine } from '@rsc-kit/core/host'
  import type { PrerenderEngine } from '@rsc-kit/core/prerender'

  const engine: RscEngine & PrerenderEngine & Required<Pick<PrerenderEngine, 'manifest'>>

  export = engine
}
`;

/**
 * Render every route once and write what can be stored.
 *
 * Imported at call time, not at the top of this file: `prerender` pulls in the
 * render pipeline, and a dev server that never prerenders should not pay for
 * loading it.
 */
/**
 * What the build classified when it classified nothing.
 *
 * With prerendering off there is no probe and no answer to report, so every
 * route is dynamic by construction rather than by measurement — printed the
 * same way so the output means the same thing either way.
 */
function reportAllDynamic(): void {
  const routes = routeManifest().routes;

  for (const route of routes) {
    // The pattern rather than a url: nothing was rendered, so there are no
    // params and inventing one would name a page that may not exist.
    const path = route.segments
      .map((segment) =>
        segment.type === "static" ? segment.value : `[${segment.value}]`,
      )
      .join("/");

    console.log(`  \u0192  /${path}`);
  }

  console.log(`
  \u0192  (Dynamic)            server-rendered on demand

  ${routes.length} dynamic — prerendering is off`);
}

/**
 * The service worker, written into the client output at build time.
 *
 * Scoped to the site root because it is served from there, so it sees every
 * navigation. Three kinds of request, three answers:
 *
 * Hashed assets are immutable by construction — the name changes when the
 * bytes do — so they are answered from the cache and only fetched once ever.
 *
 * Documents and payloads go to the network first and fall back to the cache,
 * because a page whose data moved on should say so while there is a network to
 * ask. Only the fallback is what makes a reload work with none.
 *
 * A document and its payload share a url and differ by header. They do not
 * collide, because the server sends `Vary: X-RSC, ...` and the Cache API
 * honours it when a Response is stored whole and matched with its Request.
 *
 * Nothing else is touched. An action is a POST and must never be answered from
 * a cache; anything cross-origin is somebody else's to cache.
 */
export const SERVICE_WORKER = (
  version: string,
  precache: string[],
  frozen: string[] = [],
  offlineUrl: string | null = null,
  swExtra: string | null = null,
): string => `// GENERATED by rscKit() — do not edit.
const VERSION = ${JSON.stringify(version)}
const CACHE = 'rsc-kit-' + VERSION
const PRECACHE = ${JSON.stringify(precache, null, 2)}

// The urls the build stored whole. Their answer cannot change until the next
// deploy, and a deploy changes VERSION and sweeps this cache — so for these,
// and only these, the cache is the better source and the network is the
// fallback rather than the other way round.
//
// Everything else stays network-first. A page that reads the request has a
// right answer that depends on the request, and serving yesterday's from a
// cache would be wrong in a way the visitor cannot see.
const FROZEN = new Set(${JSON.stringify(frozen)})

// The page to show when a navigation cannot be answered at all.
//
// An ordinary route at /offline, stored at build time like any other — nothing
// special about the file, only about when it is served. Null when the app has
// none, and then a navigation with nothing cached fails as it always did.
//
// Deliberately NOT the cached root. That was tried: the document IS the page
// here, so the visitor got the home page's markup under the address they asked
// for and it did not hydrate — a wrong page pretending to be the right one.
// This one is about being offline whatever url it appears under, so it is the
// only page that can honestly stand in for another.
const OFFLINE_URL = ${JSON.stringify(offlineUrl)}
${
  swExtra
    ? `
// The app's own worker code — push, notification clicks, background sync.
//
// importScripts rather than a bundled import, because this file is evaluated
// in a worker scope by the browser rather than built: whatever the app wrote is
// run as it was written, in the same global, so its listeners sit beside the
// ones below.
//
// First, so an app handler for an event this file does not handle is registered
// before anything here can call respondWith on it.
self.importScripts(${JSON.stringify(swExtra)})
`
    : ""
}

self.addEventListener('install', (event) => {
  // The new worker takes over rather than waiting for every tab to close.
  // Safe here because assets are content-hashed: a page already open keeps
  // asking for the names it was built with, and those are still cached under
  // their own version until this activates and sweeps.
  event.waitUntil(
    caches
      .open(CACHE)
      // The offline page is fetched rather than copied from the build output:
      // it is served by the host out of the prerendered directory, which this
      // worker cannot see. Added here so it is in the cache before it is
      // needed, which is the only moment it cannot be fetched.
      .then((cache) => cache.addAll(OFFLINE_URL ? [...PRECACHE, OFFLINE_URL] : PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('rsc-kit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => tellTheOpenPages()),
  )
})

// A page open right now is running the previous build's javascript, and the
// chunks it has not loaded yet were just swept. It cannot fix that by itself —
// only a reload gets the new ones — so it is told, and the app decides what to
// say about it.
//
// After the sweep rather than before, so a page acting on this immediately
// reloads into the new version rather than racing the deletion.
async function tellTheOpenPages() {
  const open = await self.clients.matchAll({ type: 'window' })

  for (const page of open) page.postMessage({ type: 'rsc-kit:updated', version: VERSION })
}

const immutable = (url) => url.pathname.startsWith('/assets/') || /-[A-Za-z0-9_-]{8,}\\.[a-z]+$/.test(url.pathname)

// Whether a response may be kept at all.
//
// \`no-store\` is not advice here, it is the answer. A query defaults to
// \`private, no-store\` precisely because it may read the session, and a worker
// that files it by url alone would serve one visitor's answer to whoever signs
// in next — the Cache API has no notion of who asked. A live response is worse
// again: the clone goes on streaming long after the page that opened it is
// gone.
//
// Checked before every put, rather than only for the paths that happen to reach
// a query today. A new cacheable route added later must not have to remember
// this.
const mayStore = (response) =>
  response.ok && !(response.headers.get('Cache-Control') || '').includes('no-store')

// What a response is filed under. A payload request carries headers the url
// does not, so the url is where they have to go.
const keyFor = (request) => {
  if (!request.headers.get('X-RSC')) return request

  const url = new URL(request.url)
  url.searchParams.set('__rsc', request.headers.get('X-RSC-Segments') || '')

  return new Request(url, { headers: request.headers })
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (immutable(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (mayStore(response)) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(request, copy))
            }

            return response
          }),
      ),
    )

    return
  }

  // A stored page, asked for without a query string. Cache first, and refresh
  // in the background so the next visit has the new one even if this worker
  // never updates.
  //
  // The query matters for the same reason it matters to a stored api route:
  // the build answered the bare url, and a page reading ?q= answers
  // differently for every value of it.
  if (FROZEN.has(url.pathname.replace(/\\/+$/, '') || '/') && !url.search) {
    event.respondWith(
      caches.match(keyFor(request)).then((hit) => {
        const fresh = fetch(request)
          .then((response) => {
            if (mayStore(response)) {
              const copy = response.clone()
              caches.open(CACHE).then((cache) => cache.put(keyFor(request), copy))
            }

            return response
          })
          .catch((error) => {
            if (hit) return hit

            throw error
          })

        // Not awaited when there is a hit: the point is that the visitor does
        // not wait for the network for a page that cannot have changed.
        return hit ?? fresh
      }),
    )

    return
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (mayStore(response)) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(keyFor(request), copy))

          // A document is not enough to boot from. The client hydrates from a
          // payload it fetches for itself, and on a first visit that request
          // happens before this worker controls the page — so it is never
          // cached, and a reload with no network has the markup and nothing to
          // hydrate it with.
          //
          // \`X-RSC: true\` and no segments header is exactly what a fresh boot
          // sends, which is what makes this entry the one it finds: the server
          // varies on those, and the Cache API matches on the same.
          if (request.mode === 'navigate') {
            const warm = new Request(request.url, { headers: { 'X-RSC': 'true' } })

            fetch(warm)
              .then((payload) => {
                if (mayStore(payload)) {
                  caches.open(CACHE).then((cache) => cache.put(keyFor(warm), payload))
                }
              })
              .catch(() => {})
          }

          // And the other way round. Moving between pages fetches payloads and
          // never documents, so a page reached only by a link had nothing to
          // serve when someone reloaded its url — it navigated fine and then
          // died on refresh, which is the half of offline nobody would trust.
          //
          // Once per url: the document is fetched only when the cache has none,
          // so this costs one extra request the first time a page is visited
          // rather than one on every navigation to it.
          if (request.headers.get('X-RSC')) {
            const document = new Request(request.url)

            caches.open(CACHE).then(async (cache) => {
              if (await cache.match(document)) return

              const fresh = await fetch(document).catch(() => null)

              if (fresh && mayStore(fresh)) await cache.put(document, fresh)
            })
          }
        }

        return response
      })
      .catch(async () => {
        const hit = await caches.match(keyFor(request))

        if (hit) return hit

        // Nothing cached for this url and no network to ask.
        //
        // Falling back to the cached ROOT was worse than failing: the document
        // IS the page here, so the visitor got the home page's markup under the
        // address they asked for, and it did not hydrate — a wrong page
        // pretending to be the right one.
        //
        // An offline page is different, and is the one page that can honestly
        // stand in for another: it is about being offline, not about the url it
        // appears under. Navigations only — a payload request answered with a
        // document would be decoded as one and throw.
        if (OFFLINE_URL && request.mode === 'navigate') {
          const page = await caches.match(OFFLINE_URL)

          if (page) return page
        }

        // Letting it fail says what is true, and a page already open is
        // unaffected.
        return Response.error()
      }),
  )
})
`;

/**
 * Write the worker beside the assets it caches.
 *
 * The version is a hash of what is being precached rather than a build id from
 * the environment. The names are content-hashed already, so a build that
 * changed nothing produces the same list and leaves the visitor's cache alone,
 * and a build that changed anything produces a different one — which is the
 * whole of cache invalidation, without asking anyone to set a variable.
 */
/**
 * Write the web app manifest into the client output, beside the assets.
 *
 * Into the same directory the browser is served from, because that is where a
 * relative icon path resolves — a manifest served from somewhere else resolves
 * its icons somewhere else too, and the failure is a browser that quietly does
 * not offer to install.
 */
/**
 * The manifest an app declared beside its routes.
 *
 * `src/app/manifest.ts`, default-exporting the object — the same shape every
 * other thing about a route tree takes here, and the reason this is a file
 * rather than a `vite.config.ts` key. A manifest is not build configuration
 * any more than a page is; it is one more thing the app declares about itself,
 * and it belongs where the app is.
 *
 * Evaluated with the TypeScript stripped rather than imported: this runs while
 * the plugin is being constructed, long before there is a module graph to pull
 * it through, and importing an app module here would drag its imports in with
 * it. The file is a literal object by contract, which is all that has to parse.
 */
export function declaredManifest(appDir: string): WebManifestOptions | null {
  for (const extension of ["ts", "tsx", "js", "mjs"]) {
    const file = join(appDir, `manifest.${extension}`);

    if (!existsSync(file)) continue;

    const source = readFileSync(file, "utf-8");
    // The object literal after `export default`, with a `satisfies` or `as`
    // annotation tolerated after it — which is how anyone who wants the type
    // checked will actually write the file, and getting that wrong would refuse
    // the recommended spelling.
    //
    // A manifest that is not a literal — computed, imported from elsewhere — is
    // refused loudly rather than silently ignored, because the failure would
    // otherwise be an app that is simply not installable with nothing said.
    const match =
      /export\s+default\s+(\{[\s\S]*\})(?:\s+(?:satisfies|as)\s+[\w.<>\[\]| ]+)?\s*;?\s*$/.exec(
        source.trim(),
      );

    if (!match) {
      throw new Error(
        `[rsc-kit] app/manifest.${extension} must default-export an object literal.\n` +
          "It is read at build time, before there is a module graph to evaluate it in, so it " +
          "cannot be computed or imported from elsewhere.",
      );
    }

    try {
      // Function rather than JSON.parse: the file is TypeScript source with
      // unquoted keys, trailing commas and comments in it, none of which JSON
      // accepts and all of which are ordinary in a file a person edits.
      return new Function(`return (${match[1]})`)() as WebManifestOptions;
    } catch (error) {
      throw new Error(
        `[rsc-kit] Could not read app/manifest.${extension}: ${(error as Error).message}`,
      );
    }
  }

  return null;
}

/**
 * Copy the icons and share images into the client output.
 *
 * They live in `app/` so the build can read them - an icon's filename decides
 * what goes in the manifest - but a browser has to be able to fetch them, and
 * nothing serves `app/`. Copied rather than symlinked: the output is what gets
 * deployed, and a link into a source tree that is not deployed points nowhere.
 */
function copyAppAssets(clientDir: string): void {
  if (!existsSync(clientDir)) return;

  const all = allAppAssets(foundAssets);

  if (all.length === 0) return;

  for (const asset of all) {
    const to = join(clientDir, asset.href.slice(1));

    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(sourceDir, "app", asset.file), to);
  }

  log(`icons: ${all.length} copied from app/`);
}

function writeWebManifest(
  clientDir: string,
  options: WebManifestOptions,
): void {
  if (!existsSync(clientDir)) return;

  writeFileSync(join(clientDir, MANIFEST_PATH.slice(1)), webManifest(options));

  const warning = manifestWarning(options);

  if (warning) log(warning);
  else log(`manifest: ${options.name} is installable`);
}

/**
 * The url a navigation falls back to when nothing else can answer it.
 *
 * An ordinary route at /offline, and it has to be one the build STORED — a
 * page that renders per request cannot be served when there is no request to
 * be made. So a dynamic /offline is refused as a fallback rather than
 * precached and found wanting at the one moment it matters, and the build says
 * which read did it.
 */
function offlineFallback(
  frozen: string[],
  results: PrerenderResult[],
): string | null {
  const found = results.find((r) => r.url === "/offline");

  if (!found) return null;

  if (!frozen.includes("/offline")) {
    // The reason already reads "dynamic — called cookies()", and this sentence
    // has said "not stored" by the time it gets there, so the prefix would say
    // it twice with a dash in the middle of both.
    const why = found.reason?.replace(/^dynamic — /, "") ?? null;

    log(
      "offline: /offline cannot be the fallback" +
        (why ? `, because it ${why}` : "") +
        ". A fallback has to be servable with no network at all.",
    );

    return null;
  }

  return "/offline";
}

/**
 * The app's own service worker code, if it wrote any.
 *
 * `src/app/sw.js`, copied next to the generated worker and imported by it. Plain
 * javascript rather than TypeScript, and that is not an oversight: it is
 * evaluated by the browser in a worker scope with no build step in front of it,
 * so what is written is what runs. Calling it .js says so.
 *
 * This is the only way to add an event this package does not handle — push,
 * notificationclick, sync — without giving up everything the generated worker
 * does. There is no option for it because there is nothing to configure: the
 * file is there or it is not.
 */
function copyServiceWorkerExtra(clientDir: string): string | null {
  const source = join(sourceDir, "app", "sw.js");

  if (!existsSync(source)) return null;

  copyFileSync(source, join(clientDir, "sw-app.js"));

  return "/sw-app.js";
}

function writeServiceWorker(
  clientDir: string,
  frozen: string[] = [],
  offlineUrl: string | null = null,
): void {
  if (!existsSync(clientDir)) return;

  // Before the walk, so it lands in the precache with everything else. The
  // worker importScripts it while evaluating, which is the one moment it cannot
  // go to the network for it — a worker whose import fails does not start, and
  // then nothing is cached at all.
  const extra = copyServiceWorkerExtra(clientDir);

  const files: string[] = [];

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Not itself, and not a map: a debugger asks for those, a visitor does
      // not, and precaching them doubles what an install costs.
      if (entry.name === "sw.js" || entry.name.endsWith(".map")) continue;

      const path = join(dir, entry.name);

      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else files.push(`${prefix}${entry.name}`);
    }
  };

  walk(clientDir, "");

  const precache = ["/", ...files.map((file) => `/${file}`)].sort();
  const version = createHash("sha256")
    .update(precache.join("\n"))
    .digest("hex")
    .slice(0, 12);

  writeFileSync(
    join(clientDir, "sw.js"),
    SERVICE_WORKER(version, precache, frozen, offlineUrl, extra),
  );

  log(
    `offline: ${precache.length} files precached as rsc-kit-${version}` +
      (offlineUrl ? `, falling back to ${offlineUrl}` : "") +
      (extra ? ", with app/sw.js" : ""),
  );
}

/**
 * The rsc bundle the build just wrote, whatever it decided to call it.
 *
 * Two things were assumed here and both were wrong for somebody. The directory
 * was assumed to be <outDir>/dist/rsc, which Nitro does not use — it builds the
 * environment under node_modules/.nitro. And the file was assumed to be
 * index.js, which Vite only emits for a package that declares `type: module`;
 * everyone else got index.mjs. Either miss returned quietly, and a build that
 * prerendered nothing printed exactly what a build with no pages to freeze
 * prints.
 */
function resolveRscBundle(dir: string): string | null {
  for (const name of ["index.js", "index.mjs"]) {
    const candidate = join(dir, name);

    if (existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Every server action the bundle registered, from the plugin's own table.
 *
 * Only the app's: the engine registers a few of its own and they are not the
 * project's to be warned about.
 */
function knownActionsOf(
  config: { plugins: readonly unknown[] },
  root: string,
): KnownAction[] {
  const api = getPluginApi(config as never);
  const metaMap = api?.manager?.serverReferences?.metaMap;

  if (!metaMap) return [];

  const out: KnownAction[] = [];

  for (const meta of metaMap.values()) {
    if (meta.importId.includes("/node_modules/")) continue;

    const file = relative(root, meta.importId.split("?")[0] ?? meta.importId);

    for (const name of meta.exportNames) {
      out.push({ id: `${meta.referenceKey}#${name}`, name, file });
    }
  }

  return out;
}

async function auditActions(
  engine: unknown,
  known: KnownAction[],
): Promise<
  { id: string; name: string; file: string; client: boolean; query: boolean }[]
> {
  const audit = (
    engine as {
      auditActions?: (
        ids: string[],
      ) => Promise<{ id: string; client: boolean; query: boolean }[]>;
    }
  ).auditActions;

  if (!audit || known.length === 0) return [];

  const byId = new Map(known.map((k) => [k.id, k]));

  return (await audit(known.map((k) => k.id))).map((a) => ({
    ...byId.get(a.id)!,
    client: a.client,
    query: a.query,
  }));
}

/**
 * Inlined into a page with no runtime when it is at most this big on the
 * wire. The point is the round trip, not the bytes: a stylesheet that
 * compresses to a few KB costs a whole trip before anything paints, while a
 * large one is better fetched once and cached across pages. Measured
 * gzipped, because that is what travels - a sheet of @font-face
 * declarations is long and compresses to almost nothing.
 */
const INLINE_STYLESHEET_LIMIT = 10 * 1024;

export function smallStylesheetReader(
  assetsDir: string,
  setting: "auto" | true | number,
): (href: string) => string | null {
  const limit =
    setting === true
      ? Infinity
      : setting === "auto"
        ? INLINE_STYLESHEET_LIMIT
        : setting;

  return (href) => {
    if (!href.startsWith("/") || href.includes("..")) return null;

    try {
      const css = readFileSync(join(assetsDir, href), "utf-8");

      return gzipSync(css).length > limit ? null : css;
    } catch {
      return null;
    }
  };
}

/** A server action the bundle registered: where it is and what it is called. */
export interface KnownAction {
  id: string;
  name: string;
  file: string;
}

async function prerenderAfterBundles(
  bundle: string | null,
  staticDir: string,
  assetsDir: string,
  knownActions: KnownAction[] = [],
): Promise<{ frozen: string[]; results: PrerenderResult[] }> {
  // A missing bundle used to be a silent `return`, and under Nitro it was the
  // normal case: the path was assumed to be <outDir>/dist/rsc/index.js, Nitro
  // builds the rsc environment somewhere else entirely, and so every Nitro app
  // — every scaffolded app, and Laravel — prerendered nothing at all. No
  // classification printed, no route frozen, and every page renders per
  // visitor. The caller resolves the path from the environment now, so this is
  // back to being the impossible case it reads as.
  if (!bundle) {
    throw new Error(
      "[rsc-kit] The build produced no rsc bundle to prerender from.\n" +
        "Prerendering renders the app, so it needs the bundle the build just wrote.",
    );
  }

  const [
    {
      prerender,
      NotPrerenderable,
      summary,
      legend,
      notes,
      clientJsSize,
      pathKey: pathKeyOf,
    },
    { writeTo },
    { prerenderApiRoutes },
  ] = await Promise.all([
    import("./prerender.js"),
    import("./files.js"),
    import("./apiPrerender.js"),
  ]);

  // Cleared first: a route that changes classification between builds
  // otherwise leaves its old shell on disk and the host goes on serving it.
  // Nothing warns — the page loads, with content from the previous build.
  rmSync(staticDir, { recursive: true, force: true });

  const engine = (await import(pathToFileURL(bundle).href)) as never;
  const mark: Record<string, string> = {
    frozen: "○",
    shell: "◐",
    blocked: "✗",
    error: "✗",
  };
  let failed = 0;

  // Weighed from the page the prerenderer just wrote, so the column is what
  // that page actually loads rather than a total every route is charged for.
  const weigh = weighClientJs(assetsDir);
  const sized = new Map<string, number>();
  const pending: { line: string; bytes: number | null; extra: string[] }[] = [];

  // Every result as it lands, so a refusal still has the whole table.
  //
  // prerender() throws NotPrerenderable when a page blocked above every
  // boundary, and it used to throw past everything below: no table printed,
  // no report written. The terminal got the advice; the report on disk was
  // the previous build's, and an agent reading it through the MCP server was
  // told the routes were fine, as of some minutes ago. A build that refuses
  // is the build an agent most needs written down.
  const collected: PrerenderResult[] = [];
  let refusal: InstanceType<typeof NotPrerenderable> | null = null;
  let results: PrerenderResult[];

  try {
    results = await prerender({
      engine,
      write: writeTo(staticDir),
      serviceWorker: offline,
      stylesheet:
        inlineStylesheets === false
          ? undefined
          : smallStylesheetReader(assetsDir, inlineStylesheets),
      onResult: (r) => {
        collected.push(r);

        if (r.type === "error" || r.type === "blocked") failed++;

        const key = pathKeyOf(r.url);
        const file = [`${key}.html`, `${key}.ppr.html`]
          .map((name) => join(staticDir, name))
          .find((path) => existsSync(path));

        const bytes = file ? weigh(readFileSync(file, "utf-8")) : null;

        if (bytes !== null) sized.set(r.url, bytes);

        pending.push({
          line: `  ${mark[r.type] ?? " "}  ${r.url}`,
          bytes,
          extra: [
            ...(r.reason ? [`     ${r.reason}`] : []),
            ...(r.note ? [`     ${r.note}`] : []),
            ...(r.warning ? [`     ⚠  ${r.warning}`] : []),
          ],
        });
      },
    });
  } catch (error) {
    if (!(error instanceof NotPrerenderable)) throw error;

    refusal = error;
    results = collected;
  }

  // After the pages, sharing their output. An api route is a url the build
  // either answered or could not, which is the same question the table above
  // is already answering — a second list under its own heading would be two
  // places to look for one fact.
  const manifest = (
    engine as { manifest(): import("./manifest.js").RouteManifest }
  ).manifest();
  const apis = await prerenderApiRoutes(engine, manifest, writeTo(staticDir));

  for (const api of apis) {
    pending.push({
      line: `  ${api.type === "frozen" ? "○" : "ƒ"}  ${api.url}`,
      bytes: null,
      extra: [
        ...(api.reason ? [`     ${api.reason}`] : []),
        ...(api.warning ? [`     ⚠  ${api.warning}`] : []),
      ],
    });
  }

  // Printed together rather than as each route lands, because a column has to
  // line up and the widest url is not known until the last one is in.
  const column = Math.max(...pending.map((p) => p.line.length)) + 2;

  for (const row of pending) {
    const size = row.bytes === null ? "" : clientJsSize(row.bytes);

    console.log(size ? row.line.padEnd(column) + size : row.line);

    for (const line of row.extra) console.log(line);
  }

  const count = (type: string) => results.filter((r) => r.type === type).length;

  // The actions, after the routes. Which ones a client built is a mark on the
  // loaded function, so the bundle is asked; the answer is the one fact about
  // an action nothing else in the app states — whether anything checks who
  // calls it.
  const audited = await auditActions(engine, knownActions);
  const bare = audited.filter((a) => !a.client);

  if (bare.length > 0) {
    const byFile = new Map<string, string[]>();

    for (const a of bare)
      byFile.set(a.file, [...(byFile.get(a.file) ?? []), a.name]);

    console.log(
      `\n  \u26a0  ${bare.length} ${bare.length === 1 ? "action runs" : "actions run"} no middleware: ` +
        [...byFile]
          .map(([file, names]) => `${names.join(", ")} (${file})`)
          .join("; "),
    );
    console.log(
      "     Nothing checks who calls them. Fine for a public one; otherwise build it\n" +
        "     from an action client, so the check cannot be forgotten.",
    );
  }

  // Server files importing cache from React. Its cache() memoises on the
  // dispatcher a render installs, so in a guard, an action, an api route or
  // the SSR pass it calls straight through - no dedupe, no error, the helper
  // runs twice. The difference is silent, which is why this line exists.
  const reactCache = reactCacheImports(sourceDir);

  if (reactCache.length > 0) {
    console.log(
      `\n  \u26a0  ${reactCache.length} server ${reactCache.length === 1 ? "file imports" : "files import"} cache from 'react': ` +
        reactCache.join(", "),
    );
    console.log(
      "     React's cache() dedupes only inside a component render; in a guard, an action or\n" +
        "     an api route it calls straight through. Import it from @rsc-kit/core/cache instead.",
    );
  }

  // Server files importing a client library. Legal - a server component may
  // render a client component from a package - but the shape that costs an
  // afternoon is a file with no "use client" that only wraps them, so the
  // library's internals run on the server. Said, with the packages and the
  // importer, so the person reading can tell which it is.
  if (clientLibraryImports.length > 0) {
    console.log(
      `\n  \u2139  ${clientLibraryImports.length} server ${clientLibraryImports.length === 1 ? "file imports" : "files import"} a client library: ` +
        clientLibraryImports
          .map(
            (c) =>
              `${c.file} (${c.packages.join(", ")}${c.from ? `; imported by ${c.from}` : ""})`,
          )
          .join("; "),
    );
    console.log(
      '     Legal for a server component. A file that only wraps client components wants "use client" -\n' +
        "     as shadcn ships it - so the server stops at the boundary.",
    );
  }

  // Written from the rows that were just printed rather than recomputed: the
  // report and the terminal must not be able to disagree about what happened.
  writeFileSync(
    join(outDir, REPORT_FILE),
    buildReport(
      results.map((r) => ({
        url: r.url,
        component: r.component,
        type: r.type,
        reason: r.reason,
        warning: r.warning ?? null,
        note: r.note ?? null,
        clientJs: sized.get(r.url) ?? null,
      })),
      apis.map((a) => ({
        url: a.url,
        name: a.name,
        type: a.type,
        reason: a.reason,
        warning: a.warning ?? null,
      })),
      audited,
      reactCache,
      clientLibraryImports,
    ),
  );

  const note = notes(results);
  const counted = [...results, ...apis];

  console.log(`
${legend(counted)}

  ${summary(counted)}${note ? `\n\n${note}` : ""}`);

  // The table and the report are on disk. Now the refusal, in its own words.
  if (refusal) throw new Error(refusal.message);

  if (failed > 0) {
    throw new Error(
      `[rsc-kit] ${failed} route${failed === 1 ? "" : "s"} failed to render.\n` +
        "Prerendering runs your app: whatever those pages need at render time has to be\n" +
        "reachable from the build. Give it that, or mark the read with `await connection()`\n" +
        "so the page renders per request and the rest of it is still stored.",
    );
  }

  if (output === "export")
    await exportAfterPrerender(results, staticDir, assetsDir);

  // The urls whose answer cannot change until the next build. The service
  // worker serves these from its cache first rather than asking the network
  // and falling back — see writeServiceWorker.
  //
  // Two narrowings beyond "frozen", and neither is redundant even though the
  // worker would survive without them. A guarded route IS frozen — the guard
  // is a serving decision, not a build one — but its response is per visitor
  // and must never be read from a cache that has no notion of who asked. A
  // redirect is stored as a destination rather than a page, so there is no
  // document to serve from a cache at all.
  //
  // Both are already refused downstream: a guarded response carries no-store
  // and a 3xx is not `ok`. Saying it here as well means the list means what it
  // says, rather than being a wider list that happens to be filtered later.
  const guarded = new Set(
    manifest.routes.filter((r) => r.middleware?.length).map((r) => r.component),
  );

  return {
    frozen: results
      .filter((r) => r.type === "frozen" && !guarded.has(r.component))
      .filter((r) => existsSync(join(staticDir, pathKeyOf(r.url) + ".html")))
      .map((r) => r.url),
    results,
  };
}

/**
 * Weighs the javascript one stored page makes the browser download.
 *
 * Read back out of the html rather than worked out from the module graph,
 * because the html is the answer: React writes a modulepreload for every chunk
 * the page needs, so whatever is in there is what the browser fetches. Nothing
 * here has to agree with the bundler about anything.
 *
 * Gzipped, and each chunk weighed once however many pages name it — the same
 * three files appear on every route and compressing them per page is the whole
 * cost of this function.
 *
 * Returns null when there is no page to weigh, which is a route rendered on
 * demand. A build must not fail over a column it prints for information.
 */
function weighClientJs(assetsDir: string): (html: string) => number | null {
  const weighed = new Map<string, number>();

  const bytesOf = (asset: string): number => {
    const cached = weighed.get(asset);

    if (cached !== undefined) return cached;

    const file = join(assetsDir, asset);
    const bytes = existsSync(file)
      ? gzipSync(readFileSync(file)).byteLength
      : 0;

    weighed.set(asset, bytes);

    return bytes;
  };

  return (html: string) => {
    if (!html) return null;

    const named = new Set<string>();

    // Split rather than matched: /assets/name.js is the only shape written, and
    // a regex over a whole document is the slower half of this function.
    for (const piece of html.split("/assets/").slice(1)) {
      const name = piece.split(/["'\s)]/)[0];

      if (name.endsWith(".js")) named.add("assets/" + name);
    }

    let total = 0;

    for (const asset of named) total += bytesOf(asset);

    return total;
  };
}

/**
 * Turn the frozen output into a directory a static host can serve.
 *
 * Part of the build rather than a script the app writes, for the same reason
 * prerendering is: it needs the results the build already has, and the engine
 * bundle they came from is somewhere only the build knows. That path used to be
 * stable enough to hard-code in an example — `build/dist/rsc/index.js` — and it
 * is not any more, because Nitro builds the rsc environment under
 * node_modules. A script asking for it would be a script that breaks.
 *
 * RSC_EXPORT_FORCE writes the site anyway and reports what it left out, which
 * is how an app is moved towards being exportable. Without it a route that
 * could not be frozen fails the build, because a shell on a static host is a
 * page that loads and then stays empty forever.
 */
async function exportAfterPrerender(
  results: PrerenderResult[],
  staticDir: string,
  assetsDir: string,
): Promise<void> {
  const [
    { exportSite, NotExportable },
    { writeTo, prerenderedFrom, copyAssets },
  ] = await Promise.all([import("./export.js"), import("./files.js")]);

  try {
    const { pages, refused } = await exportSite({
      results,
      read: prerenderedFrom(staticDir),
      write: writeTo(exportPath),
      manifest: routeManifest() as never,
      assets: copyAssets(join(assetsDir, "assets"), exportPath, "/assets/"),
      force: process.env.RSC_EXPORT_FORCE === "1",
    });

    console.log(
      `\n  Exported ${pages} page${pages === 1 ? "" : "s"} to ${relative(projectRoot, exportPath)}`,
    );

    if (refused.length > 0) {
      console.log(
        `  Left out ${refused.length}: ${refused.map((r) => r.url).join(", ")}`,
      );
    }
  } catch (error) {
    if (!(error instanceof NotExportable)) throw error;

    throw new Error(`[rsc-kit] ${error.message}`);
  }
}

/** `/posts/[slug]` — the pattern, in the shape the app writes its links in. */
function patternOf(segments: RouteSegment[]): string {
  if (segments.length === 0) return "/";

  return (
    "/" +
    segments
      .map((segment) =>
        segment.type === "static"
          ? segment.value
          : segment.type === "catchAll"
            ? `[...${segment.value}]`
            : `[${segment.value}]`,
      )
      .join("/")
  );
}

/**
 * The app's routes as a union, for `@rsc-kit/core/routes` to derive from.
 *
 * Rewritten every build like the other generated files: a route deleted from
 * the tree has to stop being a valid href, and the only thing that knows is
 * the walk that just happened.
 *
 * Interception patterns are deliberately absent. An interceptor answers a url
 * that some real route already owns — listing it would put the same href in
 * the union twice and imply you could link to a modal.
 */
function renderRouteTypes(manifest: RouteManifest): string {
  const patterns = [
    ...new Set(manifest.routes.map((route) => patternOf(route.segments))),
  ].sort();
  const apis = [
    ...new Set((manifest.apis ?? []).map((route) => patternOf(route.segments))),
  ].sort();

  // Each pattern to the page module that answers it, as a type-only import
  // from the generated file's own directory. SearchExportOf reads the page's
  // `searchParams` export, or undefined when there is none, so nothing here
  // has to look inside the file - the typechecker already has every page
  // open. One line per route, and a page without a schema costs nothing.
  const search = new Map<string, string>();

  for (const route of manifest.routes) {
    const pattern = patternOf(route.segments);

    if (search.has(pattern)) continue;

    const target = relative(typesDir, join(sourceDir, route.component)).replace(
      /\\/g,
      "/",
    );

    search.set(pattern, target.startsWith(".") ? target : "./" + target);
  }

  return [
    "// @generated — do not edit. Written by the RSC build from the route tree.",
    "//",
    "// Turns Link, navigate() and route() into typed apis: an href that no route",
    "// answers stops compiling. Delete this file and they fall back to `string`,",
    "// which is what a project that has not built yet gets.",
    "",
    "// `export {}` is load-bearing: in a file with no import or export,",
    "// `declare module` *replaces* the real module rather than augmenting it,",
    "// and Href and route() vanish from it with no error to explain why.",
    "export {}",
    "",
    "declare module '@rsc-kit/core/routes' {",
    "  interface Register {",
    patterns.length > 0
      ? "    routes:\n" +
        patterns.map((p) => "      | " + JSON.stringify(p)).join("\n")
      : "    // No routes found under the source directory.\n    routes: never",
    // The searchParams schema each page exports, read off the module's type.
    // This is what types Link's `search` prop and href() per route.
    "    search: {",
    ...[...search]
      .sort()
      .map(
        ([pattern, target]) =>
          "      " +
          JSON.stringify(pattern) +
          ": SearchExportOf<typeof import(" +
          JSON.stringify(target) +
          ")>",
      ),
    "    }",
    "  }",
    // Api routes are a separate union, so Link refuses an api url and apiUrl()
    // refuses a page. Linking to an api route navigates the browser away to a
    // json document, which is the mistake worth catching.
    "  interface RegisterApi {",
    apis.length > 0
      ? "    apis:\n" +
        apis.map((p) => "      | " + JSON.stringify(p)).join("\n")
      : "    // No route.ts files found under the source directory.\n    apis: never",
    "  }",
    "}",
    "",
  ].join("\n");
}

/** The "use server" module exposing each host function as a plain async call. */
function renderHostActions(): string {
  const lines = [
    '"use server";',
    "// @generated — do not edit. Written by the RSC build from the host action map.",
    "",
  ];

  for (const [name, target] of Object.entries(hostActions)) {
    lines.push("export async function " + name + "(...args: unknown[]) {");
    lines.push(
      "  return await (globalThis as any)." +
        hostGlobal +
        "(" +
        JSON.stringify(target) +
        ", ...args);",
    );
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

/** Ambient declaration for the host global, written beside the app's source. */
function renderHostGlobalTypes(): string {
  return [
    "// @generated — do not edit.",
    "//",
    "// " +
      hostGlobal +
      "() is installed on globalThis by the RSC worker, so it has no",
    "// import to resolve. This declares it for the typechecker; run",
    "// `tsc --noEmit` to catch calls to a host global that no longer exists.",
    "//",
    "// Deliberately not a module — no import/export — so the declaration is",
    "// global to the project without every file having to reference it.",
    "",
    "declare function " +
      hostGlobal +
      "<T = unknown>(name: string, ...args: unknown[]): Promise<T>;",
    "",
  ].join("\n");
}

// ── Discovery ────────────────────────────────────────────────────────────────

const ROUTE_FILES = [
  "page",
  "layout",
  "loading",
  "error",
  "not-found",
  "default",
  "middleware",
];
/** The methods a route.ts may export. HEAD and OPTIONS are answered for you. */
const API_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
/** `orders.section.tsx` — a region of a page that can be refreshed by name. */
const SECTION_FILE = /\.section\.(tsx|jsx|ts|js)$/;
const EXTS = ["tsx", "jsx", "ts", "js"];

function findRouteFile(dir: string, base: string): string | null {
  for (const ext of EXTS) {
    const p = join(dir, `${base}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

function componentName(absPath: string): string {
  const rel = relative(sourceDir, absPath).replace(/\\/g, "/");
  return rel.replace(/\.(tsx|jsx|ts|js)$/, "");
}

function toAlias(name: string): string {
  return "_c_" + name.replace(/[^a-zA-Z0-9]/g, "_");
}

const components = new Map<string, Component>();

/**
 * `route.ts` files, by the name a url is matched against.
 *
 * Kept apart from `components` on purpose: these are not React and never enter
 * the render. They are imported by the generated entry and called with a
 * Request, which is why they can export whatever methods they like rather than
 * a default component.
 */
const apiRoutes = new Map<
  string,
  { name: string; absPath: string; methods: string[] }
>();

function register(absPath: string): Component {
  const name = componentName(absPath);
  const existing = components.get(name);
  if (existing) return existing;
  const c: Component = { name, absPath, alias: toAlias(name) };
  components.set(name, c);
  return c;
}

/** Walk app/ collecting page/layout/loading/default/middleware components. */
/**
 * Record a route.ts and the methods it exports.
 *
 * Syntactic, deliberately. A handler assembled at runtime is not found, which
 * errs toward refusing a file whose shape we would be guessing at rather than
 * registering a url that answers 405 to everything.
 */
function registerApiRoute(absPath: string): void {
  const name = componentName(absPath);
  const source = readFileSync(absPath, "utf-8");
  const methods = API_METHODS.filter((method) =>
    new RegExp(
      `^\\s*export\\s+(?:async\\s+function|function|const|let|var)\\s+${method}\\b`,
      "m",
    ).test(source),
  );

  if (methods.length === 0) {
    // `route.ts` is also where a host declares the guards for everything below
    // it — the file predates api routes and is still read that way. One that
    // exports middleware is that file, not an endpoint, and saying so would be
    // telling someone their working config is broken.
    if (/^\s*export\s+(?:const|let|var|function)\s+middleware\b/m.test(source))
      return;

    throw new Error(
      `[rsc-kit] ${relative(projectRoot, absPath)} exports no request methods.\n` +
        `  Export one named for the method it answers — export function GET(request: Request) — ` +
        `or delete the file. One of: ${API_METHODS.join(", ")}.`,
    );
  }

  apiRoutes.set(name, { name, absPath, methods });
}

function discover(dir: string): void {
  for (const base of ROUTE_FILES) {
    const p = findRouteFile(dir, base);
    if (p) register(p);
  }

  // route.ts — an api endpoint, colocated with the pages it sits among. Read
  // for its method exports here rather than at request time, so a route that
  // exports nothing callable is a build error instead of a 404 nobody explains.
  const api = findRouteFile(dir, "route");

  if (api) registerApiRoute(api);

  // Named regions. Registered like any other component so the generated entry
  // imports them — which is what runs section() and puts the name in the
  // registry the server looks up to re-render one on its own.
  for (const entry of readdirSync(dir)) {
    if (SECTION_FILE.test(entry)) register(join(dir, entry));
  }

  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) discover(abs);
  }
}

/**
 * Which of the two metadata exports a module actually has.
 *
 * Both are read separately because the generated entry names each one it
 * mentions, and naming an export that is not there is a bundler warning on
 * every build — `Import 'generateMetadata' will always be undefined`. Most
 * pages export only the static object, so referencing both meant that warning
 * for almost every route in an app.
 */
function metadataExports(absPath: string): {
  static: boolean;
  generate: boolean;
} {
  const src = readFileSync(absPath, "utf-8");

  return {
    static: /export\s+const\s+metadata\b/.test(src),
    generate: /export\s+(async\s+)?function\s+generateMetadata\b/.test(src),
  };
}

/**
 * Which urls exist for a parameterised route.
 *
 * The one thing about a route the build cannot work out for itself: only the
 * app knows its slugs. Everything else about whether a page can be frozen is
 * observed by rendering it — a page that suspends past the shell budget, or
 * reaches for the host, says so by doing it. This is asked rather than
 * inferred because there is nothing to infer it from.
 */
function hasStaticParams(absPath: string): boolean {
  const src = readFileSync(absPath, "utf-8");

  return /export\s+((async\s+)?function\s+generateStaticParams|const\s+generateStaticParams)/.test(
    src,
  );
}

/**
 * Which url schemas a page exports.
 *
 * Read from the source rather than by importing the module, the same way
 * metadata and generateStaticParams are: this runs while the graph is being
 * generated, and importing a page here would pull the app's whole server tree
 * into the plugin.
 *
 * `const` only. A schema is a value — `export function params` would be a
 * function, which no Standard Schema is, so matching it would generate an
 * import for something that can never validate.
 */
function urlSchemaExports(absPath: string): {
  params: boolean;
  searchParams: boolean;
} {
  const src = readFileSync(absPath, "utf-8");

  return {
    params: /export\s+const\s+params\s*[=:]/.test(src),
    searchParams: /export\s+const\s+searchParams\s*[=:]/.test(src),
  };
}

// ── Codegen ──────────────────────────────────────────────────────────────────

/**
 * The dev fall-through, emitted only when there is a backend to hand a url to.
 *
 * A JavaScript host has no backend — it IS the backend — so its entry should
 * not carry this code, its constants, or the branch that tests them. Nothing
 * generated is cheaper than something generated that returns early, and it
 * keeps every backend-shaped idea out of a runtime that has no backend.
 */
const FALLBACK_CONSTS = `const FALLBACK_ORIGIN = __ORIGIN__
const FALLBACK_MARKER = 'x-rsc-renderer-fallback'
const PROXIED_MARKER = 'x-rsc-proxied-by-backend'
`;

const FALLBACK_BODY = `  const answer = await devHandler(request)

  if (answer) return answer

  // Nothing here owns this url. In development the backend usually does — a
  // Blade page, /login, a webhook, an uploaded file under /storage — so the
  // request is handed on rather than refused, and this origin is the whole
  // application instead of the RSC half of it.
  //
  // FALLBACK_MARKER is what stops this looping. The backend's own fallback
  // forwards what it cannot route BACK to this server, so without a marker a
  // url neither side owns would bounce between them until something gave out.
  // Seeing it, the backend answers 404 itself.
  // Came from the backend's own proxy, so it has already been through that
  // route table and the answer there was no. Sending it back asks the same
  // question a second time.
  if (!FALLBACK_ORIGIN || request.headers.has(PROXIED_MARKER)) {
    return new Response('Not found', { status: 404 })
  }

  // Built from the origin rather than by assigning onto a copy of this url.
  // The URL host setter keeps whatever port is already there when the value it
  // is given has none, so a portless backend — every Herd or Valet site —
  // would inherit the dev server's own port and this server would call itself.
  const here = new URL(request.url)
  const target = new URL(here.pathname + here.search, FALLBACK_ORIGIN)

  const headers = new Headers(request.headers)

  // Never forwarded: a vhost server routes on it, so telling Herd the host is
  // localhost:5173 means it has no such site and answers 404. fetch sets it
  // from the target instead.
  headers.delete('host')
  headers.set(FALLBACK_MARKER, '1')

  // What the browser actually asked for. Without these the backend generates
  // absolute urls — url(), route(), redirects, form actions — against its own
  // origin rather than this one, and a redirect walks the browser off this
  // server onto the backend.
  //
  // They only take effect if the backend trusts this proxy: Laravel needs the
  // renderer's address in trustProxies. Sent regardless, because a header an
  // untrusting backend ignores costs nothing, and the alternative is that
  // there is no way to get it right at all.
  headers.set('x-forwarded-host', here.host)
  headers.set('x-forwarded-proto', here.protocol.replace(':', ''))

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // A redirect is the backend's answer and belongs to the browser.
      // Following it here would return the destination's body under this url.
      redirect: 'manual',
      ...(hasBody ? { duplex: 'half' } : {}),
    } as RequestInit)
  } catch (error) {
    return new Response(
      // The cause, not just the wrapper: fetch reports every network failure
      // as the same 'TypeError: fetch failed', and the refused address
      // underneath it is the whole of the diagnosis.
      'The backend at ' + FALLBACK_ORIGIN + ' is not answering: ' +
        String((error as { cause?: unknown }).cause ?? error),
      { status: 502 },
    )
  }
`;

/**
 * Wire host calls when Nitro is the server.
 *
 * Every other arrangement installs this from outside: the dev server does it in
 * configureServer, and a generated server.ts passes hostCalls to
 * createRscHandler. Under Nitro there is no such file — this module IS the
 * server — so an rpc() page renders its loading fallback forever and the
 * backend never hears from it. Silent, which is the worst kind.
 *
 * Read at request time rather than at build time: the endpoint belongs to the
 * deployment, and baking it in would mean rebuilding to change where the
 * backend is.
 */
/**
 * What a generated server.ts passes, for the arrangement that has no server.ts.
 *
 * props: a page reading `params` gets its url params from the engine, and the
 * query string is merged in here — `params.q` should mean the same thing
 * whether it arrived in the path or after the ?. Only the Laravel template
 * passed this before, so the other hosts quietly did not have it.
 *
 * version: the client compares it on every navigation and falls back to a full
 * load when it changes. Without one, a browser keeps talking to a deployment
 * that is gone — worst behind a CDN, where the shell it holds may already be
 * older than the payloads it asks for.
 */
/**
 * Where frozen pages live inside `.output/server`, written by the build and
 * found by the generated entry. One constant because the two halves are in
 * different processes — a name written down twice is a name that drifts, and
 * the failure is silent: the server finds no directory, decides nothing was
 * frozen, and renders every page live exactly as it did before.
 */
const NITRO_STATIC_DIR = "rsc-static";

/**
 * Serve what the build froze.
 *
 * `import.meta.env.PROD` rather than an unconditional reader: in development
 * there is no build output to serve, and a stale one would be worse than none.
 * Vite replaces it with a literal, so the dev bundle keeps no reference to it.
 */
const NITRO_PRERENDERED = `    prerendered: import.meta.env.PROD
      ? prerenderedBeside(import.meta.url, ${JSON.stringify(NITRO_STATIC_DIR)})
      : undefined,
`;

const NITRO_HANDLER_OPTIONS = `    props: (match, request) => ({
      ...match.params,
      ...Object.fromEntries(new URL(request.url).searchParams),
    }),
    version: process.env.RSC_BUILD_VERSION,
`;

const NITRO_HOST_CALLS = `
let hostInstalled = false

function installHostCallsOnce(): void {
  if (hostInstalled) return
  hostInstalled = true

  const origin = process.env.RSC_BACKEND ?? process.env.APP_URL
  const secret = process.env.RSC_HOST_CALL_SECRET

  // Both, or neither: a secret without a backend has nowhere to go, and a
  // backend without one is refused at the door. See the dev server, which
  // gates on exactly the same pair.
  if (!origin || !secret) return

  const path = process.env.RSC_HOST_CALL_PATH ?? '/__rsc/host-call'

  installHostFn(httpHostCalls({ endpoint: origin.replace(/\\/$/, '') + path, secret }))
}

`;
function generateEntryRsc(fallbackOrigin = ""): string {
  // The 404 page, if the app has one, and the layouts it renders inside.
  // Computed here rather than looked up at runtime: not-found is not a route,
  // so the manifest has no entry to read its chain from.
  const notFoundComponent = [...components.keys()].find((name) =>
    name.endsWith("/not-found"),
  );
  const notFoundLayouts = notFoundComponent
    ? [...components.keys()]
        .filter(
          (name) =>
            name.endsWith("/layout") &&
            notFoundComponent.startsWith(name.slice(0, -"layout".length)),
        )
        .sort((a, b) => a.length - b.length)
    : [];

  const imports: string[] = [];
  const mapEntries: string[] = [];
  const metaEntries: string[] = [];
  const paramEntries: string[] = [];
  const schemaEntries: string[] = [];
  const apiEntries: string[] = [];

  // Namespace imports: a route.ts exports one function per method, and which
  // ones it exports is the thing the dispatcher needs.
  for (const [index, route] of [...apiRoutes.values()].entries()) {
    imports.push(
      `import * as __api${index} from ${JSON.stringify(route.absPath)}`,
    );
    apiEntries.push(`  ${JSON.stringify(route.name)}: __api${index},`);
  }

  for (const c of components.values()) {
    imports.push(`import ${c.alias} from ${JSON.stringify(c.absPath)}`);
    mapEntries.push(`  ${JSON.stringify(c.name)}: ${c.alias},`);

    const meta = metadataExports(c.absPath);

    if (meta.static || meta.generate) {
      imports.push(
        `import * as ${c.alias}_meta from ${JSON.stringify(c.absPath)}`,
      );

      const fields = [
        meta.static ? `static: ${c.alias}_meta.metadata` : null,
        meta.generate ? `generate: ${c.alias}_meta.generateMetadata` : null,
      ].filter(Boolean);

      metaEntries.push(
        `  ${JSON.stringify(c.name)}: { ${fields.join(", ")} },`,
      );
    }

    if (hasStaticParams(c.absPath)) {
      // The namespace import may already be in place for metadata; a second
      // one of the same module is the same binding, so this is safe to repeat.
      imports.push(
        `import * as ${c.alias}_params from ${JSON.stringify(c.absPath)}`,
      );
      paramEntries.push(
        `  ${JSON.stringify(c.name)}: ${c.alias}_params.generateStaticParams,`,
      );
    }

    const urlSchemas = urlSchemaExports(c.absPath);

    if (urlSchemas.params || urlSchemas.searchParams) {
      imports.push(
        `import * as ${c.alias}_schema from ${JSON.stringify(c.absPath)}`,
      );

      const fields = [
        urlSchemas.params ? `params: ${c.alias}_schema.params` : null,
        urlSchemas.searchParams
          ? `searchParams: ${c.alias}_schema.searchParams`
          : null,
      ].filter(Boolean);

      schemaEntries.push(
        `  ${JSON.stringify(c.name)}: { ${fields.join(", ")} },`,
      );
    }
  }

  // The engine's own modules are named without an extension: this plugin runs
  // from src/ in its own repo and from dist/ once published, and Vite resolves
  // either. Naming .tsx here builds fine from source and fails after publish.
  return `// GENERATED by rscKit() — do not edit.
import { SegmentBoundary } from ${JSON.stringify(join(packageDir, "js/SegmentBoundary"))}
import { DocumentTitle } from ${JSON.stringify(join(packageDir, "js/DocumentTitle"))}
import { SlotBoundary } from ${JSON.stringify(join(packageDir, "js/SlotBoundary"))}
import { RouteErrorBoundary } from ${JSON.stringify(join(packageDir, "js/RouteErrorBoundary"))}
import { sectionComponent } from ${JSON.stringify(join(packageDir, "js/section"))}
import { PathnameProvider } from ${JSON.stringify(join(packageDir, "js/PathnameProvider"))}
import { searchParams as requestSearchParams } from ${JSON.stringify(join(packageDir, "request"))}
import { parseParams, parseSearchParams, parseBody, isSearchParamsError, isBodyError } from ${JSON.stringify(join(packageDir, "routeSchema"))}
import { notFoundDigest, isNotFoundSignal } from ${JSON.stringify(join(packageDir, "notFound"))}
import { noteRequestRead } from ${JSON.stringify(join(packageDir, "request"))}
import { redirectDigest } from ${JSON.stringify(join(packageDir, "redirectDigest"))}
import { createRscHandler } from ${JSON.stringify(join(packageDir, "host"))}
import { httpHostCalls } from ${JSON.stringify(join(packageDir, "hostCalls"))}
import { prerenderedBeside } from ${JSON.stringify(join(packageDir, "files"))}
import { renderToReadableStream, decodeReply, loadServerAction } from '@vitejs/plugin-rsc/rsc'
import { isQuery, queryCacheControl, isQueryValidationError } from ${JSON.stringify(join(packageDir, "query"))}
import { isActionValidationError, isClientBuilt } from ${JSON.stringify(join(packageDir, "action"))}
import { noteFallback as noteCaughtRead } from ${JSON.stringify(join(packageDir, "request"))}
import { isOutdatedOptimizedDep, outdatedDepResponse } from ${JSON.stringify(join(packageDir, "devReload"))}
import { sharedDepth } from ${JSON.stringify(join(packageDir, "routing"))}
import { Suspense, createElement, Fragment } from 'react'
import { AsyncLocalStorage } from 'node:async_hooks'
${imports.join("\n")}

type HostFn = (name: string, ...args: unknown[]) => Promise<unknown>
type LayoutEntry = { component: string; props?: Record<string, unknown> }
type SlotOverride = { component: string; props?: Record<string, unknown> }

const components: Record<string, any> = {
${mapEntries.join("\n")}
}

/**
 * The url schemas a page exported, by component name.
 *
 * Empty for a page that exported none, which is the common case — the lookup
 * below then hands the url through untouched and costs a property read.
 */
/**
 * The manifest to link from every page, or null when the app declared none.
 *
 * A literal rather than a define: defines are configured per environment and
 * this is read while rendering, in the rsc one. Generated in, so an app with
 * no manifest carries the word null and no branch worth taking.
 */
/** Head tags for the icons and share images found in app/. */
const APP_HEAD: { tag: any; props: Record<string, string> }[] = ${JSON.stringify(
    headTags(foundAssets),
  )}

const WEB_MANIFEST: { href: string; themeColor?: string } | null = ${JSON.stringify(
    webManifestOptions
      ? {
          href: MANIFEST_PATH,
          ...(webManifestOptions.themeColor
            ? { themeColor: webManifestOptions.themeColor }
            : {}),
        }
      : null,
  )}

const urlSchemas: Record<string, { params?: any; searchParams?: any }> = {
${schemaEntries.join("\n")}
}

/** route.ts modules, by the name the manifest matched. */
const apiRoutes: Record<string, any> = {
${apiEntries.join("\n")}
}

/**
 * Answer an api route.
 *
 * The handler is handed an ordinary Request and the route params, and whatever
 * Response it returns is the answer. Nothing renders; there is no payload and
 * no client involved.
 *
 * HEAD falls back to GET, which is what the spec says it is — the same response
 * without a body. Answering 405 instead breaks link checkers and anything that
 * probes before it fetches.
 */
/**
 * A promise that does not start until something awaits it.
 *
 * A thenable rather than a promise for the reason pageSearchParams is one:
 * every handler is handed all three of these whether it reads them or not, and
 * a real promise would run the work - and record the read - for every route on
 * every request.
 */
function lazily<T>(start: () => Promise<T>): Promise<T> {
  let pending: Promise<T> | null = null

  const begin = (): Promise<T> => {
    if (!pending) {
      pending = start()
      pending.catch(() => {})
    }

    return pending
  }

  return {
    then: (ok, fail) => begin().then(ok, fail),
    catch: (fail) => begin().catch(fail),
    finally: (done) => begin().finally(done),
  } as Promise<T>
}

/** Whether a method may carry a body worth reading. */
function hasBody(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
}

/**
 * What an api route answers when its own schema refused the request.
 *
 * Three statuses, because the three failures are three different things and
 * collapsing them would leave a client unable to tell a url that names nothing
 * from one it addressed wrongly:
 *
 *   404  the params do not describe a resource - the url names nothing
 *   400  the query string is wrong - the resource exists, the request did not
 *   422  the body is wrong - the same status an action returns for the same
 *        failure, so a client has one shape to handle
 */
function refusedInput(error: unknown): Response {
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  if (isNotFoundSignal(error)) return json(404, { message: 'Not found' })

  if (isSearchParamsError(error)) {
    return json(400, { message: error.message, errors: error.errors })
  }

  if (isBodyError(error)) return json(422, { message: error.message, errors: error.errors })

  throw error
}

export async function handleApiRoute(
  name: string,
  request: Request,
  params: Record<string, string>,
  allow: string,
): Promise<Response> {
  applyHost()

  const mod = apiRoutes[name]
  const method = request.method
  const handler = mod?.[method] ?? (method === 'HEAD' ? mod?.GET : undefined)

  if (!handler) {
    // Allow is not optional on a 405: without it a client cannot tell which
    // methods would have worked, and neither can a person reading the logs.
    return new Response('Method not allowed', { status: 405, headers: { Allow: allow } })
  }

  // Awaited by the handler, not before it - the same shape a page's props have,
  // and for more than symmetry. A route that never awaits its query string
  // provably does not vary by it, so the build can store one answer and the
  // host can serve it for any query at all. Resolved eagerly here, that fact
  // is unknowable and every ?utm_source= misses the stored answer.
  //
  // Schemas stay optional per route and per kind. A route that exported none
  // gets the raw params, the URLSearchParams, and a body nobody has read.
  const input = {
    params: lazily(() => parseParams(mod.params, params)),
    searchParams: lazily(() => {
      // Declaring a schema is itself a statement that the query matters, so a
      // route with one is treated as varying by it whether or not the handler
      // reaches for the value.
      noteRequestRead('searchParams')

      return parseSearchParams(mod.searchParams, new URL(request.url).searchParams)
    }),
    body: hasBody(method) ? lazily(() => parseBody(mod.body, request)) : undefined,
  }

  if (mod.searchParams) noteRequestRead('searchParams')

  let answer
  try {
    answer = await handler(request, input)
  } catch (error) {
    // A refusal raised by one of the thenables above surfaces here, because the
    // handler awaited it and did not catch it. Anything else is the route's own
    // failure and is left to the caller.
    return refusedInput(error)
  }

  // A HEAD answered by GET must not carry a body.
  if (method === 'HEAD' && answer instanceof Response) {
    return new Response(null, { status: answer.status, headers: answer.headers })
  }

  return answer
}

const metadataMap: Record<string, { static?: any; generate?: (p: any) => any }> = {
${metaEntries.join("\n")}
}

const staticParamsMap: Record<string, () => any> = {
${paramEntries.join("\n")}
}

/**
 * The route table this bundle was built from.
 *
 * Embedded rather than read back from routes.json, so a host cannot pair a
 * fresh bundle with a stale manifest — the two came out of the same build and
 * now cannot be separated. The file is still written, because a host that
 * cannot import a JavaScript module has no other way to read it.
 */
export function manifest(): any {
  return ${JSON.stringify(routeManifest())}
}

/**
 * For each server action id, whether a client built it. The build asks after
 * the bundle exists, because the answer is a mark on the loaded function and
 * nothing static could tell a wrapped export from a bare one.
 */
export async function auditActions(ids: string[]): Promise<{ id: string; client: boolean; query: boolean }[]> {
  const out: { id: string; client: boolean; query: boolean }[] = []

  for (const id of ids) {
    let fn: unknown = null

    try {
      fn = await loadServerAction(id)
    } catch {
      continue
    }

    if (typeof fn !== 'function') continue

    out.push({ id, client: isClientBuilt(fn), query: isQuery(fn) })
  }

  return out
}

/**
 * The param sets a route declares, or null when it declares none.
 *
 * Null and [] are different answers: no generateStaticParams means the route
 * is rendered on demand, an empty array means the app looked and there is
 * nothing to build. Collapsing them silently prerenders nothing for a route
 * that asked for everything, or the reverse.
 */
export async function getStaticParams(component: string): Promise<Record<string, string>[] | null> {
  const generate = staticParamsMap[component]

  if (!generate) return null

  return (await generate()) as Record<string, string>[]
}

// The host installs its callable via installHostFn. The global must be set
// synchronously INSIDE each render fn (applyHost) right before
// renderToReadableStream — setting it once ahead of a separate render call does
// not reach the Flight render.
const HOST_GLOBAL = ${JSON.stringify(hostGlobal)}

/**
 * The reserved name a host answers route middleware on.
 *
 * Prefixed so it cannot collide with a function an application registered.
 * A host that has never heard of it answers "no such function", which
 * throws — the correct answer for a guarded route on a host that cannot
 * check the guard.
 */
const HOST_MIDDLEWARE_FN = '__rsc.middleware'

let currentHost: HostFn | null = null

export function installHostFn(fn: HostFn) {
  currentHost = fn
  return () => {
    if (currentHost === fn) currentHost = null
  }
}

/**
 * The probe's stand-in host, for whichever render is asking.
 *
 * Held in async context rather than on the global, because two prerenders
 * running at once each need their own. The previous shape saved the real host,
 * overwrote the global and restored it afterwards — correct for one render at
 * a time and silently wrong for two: the second overwrites the first's saved
 * value, and both pages then call whichever closure assigned last, so
 * usedDynamicApis is recorded against the wrong page and routes are
 * misclassified. Benign for a host that installs none; wrong for any host
 * that does.
 */
const probeHost = new AsyncLocalStorage<(...args: unknown[]) => Promise<unknown>>()

function applyHost() {
  // A dispatcher, installed once. App code calls a global; which implementation
  // that reaches is a question about the render it is inside.
  //
  ;(globalThis as Record<string, unknown>)[HOST_GLOBAL] = (...args: unknown[]) => {
    const fn = probeHost.getStore() ?? currentHost

    // An optional call was here, and it answered every rpc() with undefined
    // when no host was installed. undefined is a value: the component renders
    // with it, the render succeeds, and a prerender freezes the result. The
    // page then hydrates against an undefined prop, the client component reads
    // a property of it, React unmounts the document, and the browser shows a
    // blank page with nothing in the console.
    //
    // No backticks in this region — everything from the generated entry
    // onward is a template literal, and one ends it here.
    // Rejected rather than thrown: rpc() is documented to return a promise, so
    // a caller that stores it before awaiting must get a rejection, not an
    // exception from the call itself.
    if (!fn) {
      return Promise.reject(
        new Error(
          'No host callable is installed, so ' + String(args[0]) + ' cannot be answered. ' +
            'A render that needs the host must either run with one installed or be probed.',
        ),
      )
    }

    return fn(...args)
  }
}

/**
 * Which layout renders a given slot.
 *
 * The slot component's own path names the directory that declares it:
 * app/docs/@modal/default is declared in app/docs, and the layout there is the
 * one whose props it belongs in. Falls back to the innermost layout when
 * nothing matches, which is the shape a single-layout app has anyway.
 */
function ownerLayoutIndex(slotComponent: string, layouts: LayoutEntry[]): number {
  const at = slotComponent.indexOf('/@')
  if (at === -1) return layouts.length - 1

  const ownerDir = slotComponent.slice(0, at)
  const suffix = '/layout'
  const found = layouts.findIndex(
    (l) => (l.component.endsWith(suffix) ? l.component.slice(0, -suffix.length) : l.component) === ownerDir,
  )

  return found === -1 ? layouts.length - 1 : found
}

/**
 * The query string, prepared for a page that may never ask for it.
 *
 * Created for every render but awaited by almost none, so its rejection has to
 * be claimed here: an unhandled one fails the render of a page that did
 * nothing wrong. Awaiting it still surfaces the real error.
 */
function pageSearchParams(): Promise<URLSearchParams> {
  // Lazy. Every page is handed this whether it reads it or not, and reading the
  // request is what marks a page as needing one — so starting it eagerly told
  // the build that every page was dynamic, and put url() beside every route in
  // the output as though someone had written it.
  //
  // A thenable rather than a promise, so nothing happens until a page awaits.
  let pending: Promise<URLSearchParams> | null = null

  const start = (): Promise<URLSearchParams> => {
    if (!pending) {
      pending = requestSearchParams()

      // Attached here for the same reason it always was: during a prerender
      // this never settles, and an unobserved rejection ends the process.
      pending.catch(() => {})
    }

    return pending
  }

  return {
    then: (ok, fail) => start().then(ok, fail),
    catch: (fail) => start().catch(fail),
    finally: (done) => start().finally(done),
  } as Promise<URLSearchParams>
}

/**
 * A page's params, through its own schema if it exported one.
 *
 * Laziness is preserved on purpose. The params promise may be one that never
 * settles - that is how the prerender probe says "not for any particular url"
 * - so this must not await eagerly. Chaining keeps a never-settling promise
 * never-settling, and the schema runs only if the page reads it.
 */
function checkedParams(
  schemas: { params?: any } | undefined,
  params: Promise<Record<string, unknown>>,
): Promise<unknown> {
  if (!schemas || !schemas.params) return params

  return params.then((value) => parseParams(schemas.params, value))
}

/**
 * A page's query string, through its own schema if it exported one.
 *
 * Wrapped as a thenable rather than chained, so a page that never reads the
 * query still never starts the read - the whole thing pageSearchParams exists
 * to guarantee. Calling .then on it here would start it for every page, and
 * every page would be reported as reading the request.
 */
function checkedSearchParams(
  schemas: { searchParams?: any } | undefined,
  search: Promise<URLSearchParams>,
): Promise<unknown> {
  if (!schemas || !schemas.searchParams) return search

  let pending: Promise<unknown> | null = null

  const start = (): Promise<unknown> => {
    if (!pending) {
      pending = search.then((value) => parseSearchParams(schemas.searchParams, value))
      pending.catch(() => {})
    }

    return pending
  }

  return {
    then: (ok, fail) => start().then(ok, fail),
    catch: (fail) => start().catch(fail),
    finally: (done) => start().finally(done),
  } as Promise<unknown>
}

let errorChains: Record<string, string[]> | null = null

/** The error.tsx files above a component, outermost first. */
function errorChain(component: string): string[] {
  if (!errorChains) {
    errorChains = {}

    for (const route of manifest().routes as { component: string; errors?: string[] }[]) {
      if (route.errors?.length) errorChains[route.component] = route.errors
    }
  }

  return errorChains[component] ?? []
}

// Composition: layout(outer..inner) > Suspense(loading, innermost-first) > page.
function buildElement(
  component: string,
  props: Record<string, unknown>,
  layouts: LayoutEntry[],
  loadings: string[],
  parallelSlots: Record<string, string>,
  slotOverrides: Record<string, SlotOverride>,
  head: unknown[] = [],
  from = 0,
  pageKey = '',
  bootstrap = true,
  // What await params gives the page. A never-settling one is how the
  // prerender probe says "not for any particular url": the page suspends where
  // it reads, everything above it still paints, and that is a shell one file
  // can serve for every url the route matches.
  params: Promise<Record<string, unknown>> = Promise.resolve(props),
) {
  const Component = components[component]
  if (!Component) throw new Error('Unknown RSC component: ' + component)

  // Awaitable rather than spread. Spread, a page reads its slug synchronously
  // and renders to completion during the probe — producing a page about an
  // invented value, right for nothing — which is why such a route could only
  // ever be rendered per request.
  const schemas = urlSchemas[component]

  let element = createElement(Component, {
    params: checkedParams(schemas, params),
    searchParams: checkedSearchParams(schemas, pageSearchParams()),
  })

  for (let i = loadings.length - 1; i >= 0; i--) {
    const Loading = components[loadings[i]]
    element = createElement(Suspense, { fallback: Loading ? createElement(Loading) : null }, element)
  }

  // Outside the Suspense boundary, innermost first — the nearest error.tsx to
  // the failure answers, the same rule loading.tsx follows. Outside, so a
  // component that throws while its fallback is showing is still caught.
  //
  // Read from the route table rather than passed in, for the same reason the
  // middleware chain is: every render path is covered by construction, and no
  // caller has to remember to forward them.
  const errors = errorChain(component)

  for (let i = errors.length - 1; i >= 0; i--) {
    const Fallback = components[errors[i]]

    if (!Fallback) continue

    element = createElement(
      RouteErrorBoundary,
      { fallback: Fallback as never, resetKey: pageKey || component },
      element,
    )
  }

  // <title>/<meta> go OUTSIDE the Suspense boundaries so they reach the shell
  // immediately — inside, they would be withheld until the page's data
  // resolves, delaying the whole document on a slow page.
  if (head.length) element = createElement(Fragment, null, ...head, element)

  // A slot belongs to the layout in the directory that declares it, which is
  // not necessarily the innermost one: slots are collected by walking up from
  // the page to the app root. Handing every slot to the innermost layout drops
  // any the innermost does not declare, silently — the page renders, the modal
  // just never appears.
  const slotsByLayout = new Map<number, Record<string, unknown>>()

  for (const [slot, value] of Object.entries(parallelSlots)) {
    const override = slotOverrides[slot]
    let rendered: unknown = null

    // Slot components are pages too — an interceptor is a page in a slot — so
    // they get the same awaitables the page does rather than spread values.
    if (override) {
      const OverrideComp = components[override.component]
      rendered = OverrideComp
        ? createElement(OverrideComp, {
            params: Promise.resolve(override.props ?? {}),
            searchParams: pageSearchParams(),
          })
        : null
    } else {
      const SlotComp = components[value]
      rendered = SlotComp
        ? createElement(SlotComp, { params, searchParams: pageSearchParams() })
        : null
    }

    const owner = ownerLayoutIndex(value, layouts)
    if (owner < from) continue

    const bucket = slotsByLayout.get(owner) ?? {}
    // Wrapped so an action can put a re-rendered slot here without the page
    // around it being asked for again. With nothing stored the boundary
    // renders exactly what is passed, so this changes nothing on its own.
    bucket[slot] = bootstrap ? createElement(SlotBoundary, { name: slot }, rendered) : rendered
    slotsByLayout.set(owner, bucket)
  }

  // Indices stay absolute: from skips the layouts the client already has
  // mounted, so slot ownership and boundary depth mean the same thing whether
  // this is a whole document or one segment of it.
  for (let i = layouts.length - 1; i >= from; i--) {
    const Layout = components[layouts[i].component]
    if (!Layout) continue

    // The seam a navigation can replace on its own. Depth counts from the
    // outermost layout, so depth 1 is everything below the root layout and the
    // deepest boundary wraps the page alone. With nothing in the client store
    // these render their children unchanged.
    //
    // It is a client component, so a route shipping no runtime must not get
    // one — otherwise every page would drag React in for a seam nothing can
    // use, and no page could ever be JS-free.
    if (bootstrap) {
      element = createElement(SegmentBoundary, { depth: i + 1, pageKey }, element)
    }

    element = createElement(Layout, {
      ...(layouts[i].props ?? {}),
      ...(slotsByLayout.get(i) ?? {}),
      children: element,
    })
  }

  // The url the client hooks answer with during a server render. Outside the
  // boundaries, so a page keeps it across a partial navigation; omitted with
  // the runtime, since a route shipping none has nothing to read it.
  if (bootstrap && pageKey) {
    element = createElement(PathnameProvider, { value: pageKey }, element)
  }

  return element
}

// Resolve route metadata into React elements. React 19 hoists <title>/<meta>
// rendered anywhere in the tree into <head> — so the "vite way" for metadata is
// to render it as elements, rather than a backend injecting a <head> string.
async function renderTree(
  component: string,
  props: Record<string, unknown>,
  layouts: LayoutEntry[],
  loadings: string[],
  parallelSlots: Record<string, string>,
  slotOverrides: Record<string, SlotOverride>,
  from = 0,
  pageKey = '',
  bootstrap = true,
  params?: Promise<Record<string, unknown>>,
) {
  // The FULL chain, always: a title template lives on an outer layout, and a
  // partial render still has to produce the same <title> the whole document
  // would have.
  const md = await resolveMetadata(component, props, layouts)
  const head: unknown[] = []

  // Rendered into the tree rather than written into the app's layout: React
  // hoists a link and a meta into <head> from anywhere, so this works for an
  // app that already has a layout and never asks anyone to edit one. The
  // engine knows the manifest exists; the app should not have to.
  // Icons and share images the build found in app/. Rendered here so React
  // hoists them into <head>, the same way the manifest link is — an app never
  // edits its layout to get a favicon.
  // Where the site lives, for making a relative image or url absolute. Read
  // here, above the found images, because those are the ones most likely to
  // be relative: an opengraph-image.png in app/ is emitted as /_app/..., and a
  // share-card scraper needs the origin in front of it.
  const base = md?.metadataBase ? String(md.metadataBase) : null
  const absolute = (value: unknown): string => {
    const text = String(value instanceof URL ? value.href : value)

    if (!base || /^[a-z][a-z0-9+.-]*:/i.test(text)) return text

    return new URL(text, base).href
  }

  for (const [i, found] of APP_HEAD.entries()) {
    const props = { ...found.props }

    if (props.content && /^(og:image|twitter:image)$/.test(props.property ?? props.name ?? '')) {
      props.content = absolute(props.content)
    }

    head.push(createElement(found.tag, { key: '__a' + i, ...props }))
  }

  if (WEB_MANIFEST) {
    head.push(createElement('link', { key: '__mf', rel: 'manifest', href: WEB_MANIFEST.href }))

    if (WEB_MANIFEST.themeColor) {
      head.push(
        createElement('meta', { key: '__tc', name: 'theme-color', content: WEB_MANIFEST.themeColor }),
      )
    }
  }

  if (md) {
    if (md.title != null) {
      // The element is what a server render puts in <head>, and what a route
      // with no runtime relies on entirely.
      head.push(createElement('title', { key: '__t' }, String(md.title)))

      // And the effect is what keeps it right once pages are retained — see
      // DocumentTitle. Only where there is a runtime to run it: a client
      // component on a route that ships none is refused by the build.
      if (bootstrap) head.push(createElement(DocumentTitle, { key: '__ts', title: String(md.title) }))
    }
    if (md.description != null) head.push(createElement('meta', { key: '__d', name: 'description', content: String(md.description) }))

    // robots is a string, or the object Next takes: index and follow as
    // their no- forms, the flags by name, the limits as name:value. googleBot
    // is the same shape for the googlebot tag. The object used to fall
    // through to the catch-all below as "[object Object]" - which no crawler
    // reads, on the one page that asked not to be indexed.
    const robotsContent = (value: unknown): string => {
      if (typeof value !== 'object' || value === null) return String(value)

      const r = value as Record<string, unknown>
      const parts: string[] = []

      if (r.index != null) parts.push(r.index ? 'index' : 'noindex')
      if (r.follow != null) parts.push(r.follow ? 'follow' : 'nofollow')
      for (const flag of ['noarchive', 'nosnippet', 'noimageindex', 'nocache', 'notranslate', 'indexifembedded', 'nositelinkssearchbox']) {
        if (r[flag]) parts.push(flag)
      }
      if (r.unavailable_after != null) parts.push('unavailable_after: ' + String(r.unavailable_after))
      for (const limit of ['max-video-preview', 'max-image-preview', 'max-snippet']) {
        if (r[limit] != null) parts.push(limit + ':' + String(r[limit]))
      }

      return parts.join(', ')
    }

    if (md.robots != null) {
      head.push(createElement('meta', { key: '__r', name: 'robots', content: robotsContent(md.robots) }))

      const bot = typeof md.robots === 'object' ? (md.robots as { googleBot?: unknown }).googleBot : null

      if (bot != null) head.push(createElement('meta', { key: '__rg', name: 'googlebot', content: robotsContent(bot) }))
    }

    // og: and its relatives are PROPERTY, not name. Facebook's scraper - and
    // Slack's, and LinkedIn's - reads only property=, so every og tag this
    // used to emit with name= was invisible to the thing it existed for.
    // Twitter reads name=, which is why the two are not one rule.
    const isProperty = (k: string) => /^(og|article|profile|book|music|video|fb):/.test(k)
    // The keys whose CONTENT is a url. Exact, plus the :url and :secure_url
    // spellings - not og:image:width, which a looser match turned into
    // https://site/1200 and no scraper would ever read.
    const isUrlKey = (k: string) => /^(og:image|og:url|twitter:image)(:(secure_)?url)?$/.test(k)
    const tag = (k: string, v: unknown) =>
      createElement('meta', {
        key: '__m_' + k + '_' + String(v).slice(0, 40),
        [isProperty(k) ? 'property' : 'name']: k,
        content: isUrlKey(k) ? absolute(v) : String(v),
      })

    // One image, or several. Each becomes its own og:image plus the size and
    // alt tags beside it, which is how a scraper is told which is which.
    const images = (prefix: string, value: unknown): void => {
      const list = Array.isArray(value) ? value : [value]

      for (const item of list) {
        if (item == null) continue

        if (typeof item === 'object' && !(item instanceof URL)) {
          const image = item as { url: unknown; width?: number; height?: number; alt?: string; type?: string }

          head.push(tag(prefix, image.url))
          if (image.width) head.push(tag(prefix + ':width', image.width))
          if (image.height) head.push(tag(prefix + ':height', image.height))
          if (image.alt) head.push(tag(prefix + ':alt', image.alt))
          if (image.type) head.push(tag(prefix + ':type', image.type))
        } else {
          head.push(tag(prefix, item))
        }
      }
    }

    if (md.openGraph) {
      const og = md.openGraph as Record<string, unknown>

      if (og.title != null) head.push(tag('og:title', og.title))
      if (og.description != null) head.push(tag('og:description', og.description))
      if (og.url != null) head.push(tag('og:url', og.url))
      if (og.siteName != null) head.push(tag('og:site_name', og.siteName))
      if (og.type != null) head.push(tag('og:type', og.type))
      if (og.locale != null) head.push(tag('og:locale', og.locale))
      if (og.images != null) images('og:image', og.images)
    }

    if (md.twitter) {
      const tw = md.twitter as Record<string, unknown>

      if (tw.card != null) head.push(tag('twitter:card', tw.card))
      if (tw.title != null) head.push(tag('twitter:title', tw.title))
      if (tw.description != null) head.push(tag('twitter:description', tw.description))
      if (tw.site != null) head.push(tag('twitter:site', tw.site))
      if (tw.creator != null) head.push(tag('twitter:creator', tw.creator))
      if (tw.images != null) images('twitter:image', tw.images)
    }

    // icons is links, not meta. A string is one icon; an object names which
    // rel each is for. The ones found in app/ are already in APP_HEAD above,
    // so this is for an app that wants to say it explicitly.
    const links = (rel: string, value: unknown): void => {
      const list = Array.isArray(value) ? value : [value]

      for (const item of list) {
        if (item == null) continue

        const icon = typeof item === 'object' && !(item instanceof URL)
          ? (item as Record<string, unknown>)
          : { url: item }

        head.push(
          createElement('link', {
            key: '__i_' + rel + '_' + String(icon.url).slice(0, 40),
            rel: (icon.rel as string) ?? rel,
            href: absolute(icon.url),
            ...(icon.type ? { type: icon.type } : {}),
            ...(icon.sizes ? { sizes: icon.sizes } : {}),
            ...(icon.media ? { media: icon.media } : {}),
          }),
        )
      }
    }

    if (md.icons != null) {
      const icons = md.icons as Record<string, unknown> | string | unknown[]

      if (typeof icons === 'string' || Array.isArray(icons) || icons instanceof URL) {
        links('icon', icons)
      } else {
        if (icons.icon != null) links('icon', icons.icon)
        if (icons.apple != null) links('apple-touch-icon', icons.apple)
        if (icons.shortcut != null) links('shortcut icon', icons.shortcut)
        if (icons.other != null) links('icon', icons.other)
      }
    }

    // other is flattened in beside the named keys, because it is a place to put
    // meta tags rather than a meta tag by that name. A key at the top level
    // still renders - the type no longer invites one, but an app written
    // against the old shape must not silently lose its tags.
    const structured = new Set(['title', 'description', 'robots', 'metadataBase', 'openGraph', 'twitter', 'icons', 'other'])
    const named = Object.entries(md).filter(([k]) => !structured.has(k))
    const extra = Object.entries((md.other ?? {}) as Record<string, unknown>)

    for (const [k, v] of [...named, ...extra]) {
      if (v == null) continue

      if (Array.isArray(v)) {
        for (const item of v) head.push(tag(k, item))
      } else {
        head.push(tag(k, v))
      }
    }
  }

  // Metadata elements are rendered INSIDE the document tree so React 19 hoists
  // <title>/<meta> into <head> (hoisting only works from within the tree).
  return buildElement(component, props, layouts, loadings, parallelSlots, slotOverrides, head, from, pageKey, bootstrap, params)
}

/**
 * The shallowest layout this render must actually produce.
 *
 * An interceptor replaces a slot on the layout that declares it. If that layout
 * is one the client already has, a partial render would never reach it and the
 * modal would silently not appear — so the render is widened to include it.
 */
function segmentStart(
  from: number,
  layouts: LayoutEntry[],
  parallelSlots: Record<string, string>,
  slotOverrides: Record<string, SlotOverride>,
): number {
  let start = from

  for (const slot of Object.keys(slotOverrides)) {
    const declared = parallelSlots[slot]
    if (!declared) continue

    const owner = ownerLayoutIndex(declared, layouts)
    if (owner < start) start = owner
  }

  return start
}

/**
 * Run a route's middleware before anything at or below them is rendered.
 *
 * A guard is middleware.ts in a directory: a function that returns nothing and
 * refuses by redirecting or throwing. It exists because a check is not UI, and
 * making it one was the problem — a layout that checks who you are is also a
 * layout that fetches a nav bar, and the two have opposite needs.
 *
 * Layouts are skipped on a partial navigation, which is the whole point of
 * partial navigation, and the client decides how many to skip by naming what
 * it claims to hold. Nothing verifies that claim; nothing can. So a check that
 * lives in a layout is a check the caller can decline. Forcing the layout to
 * run instead makes every navigation pay for its data fetching to re-run a
 * check that costs one query.
 *
 * Guards are not part of that arithmetic. Every render path runs the whole
 * chain, in order, outermost first — a full load, a partial navigation, a
 * revalidation, an interception. There is no marker to forget: the file is the
 * declaration.
 */
let middlewareChains: Record<string, string[]> | null = null

let hostChains: Record<string, string[]> | null = null

/**
 * Guards the host runs, named by a route.ts and meaningless here.
 *
 * Asked before the engine's own middleware.ts guards, because a host's are the
 * coarser check — a session, a rate limit — and running application code to
 * decide whether application code may run is the wrong way round.
 *
 * It fails CLOSED, and that is the whole of its design. This call reaches
 * another process over a network, so it can time out, be refused, or answer
 * something unparseable — and every one of those is a guarded page rendered to
 * whoever asked, if the absence of a refusal is read as permission. Only a
 * literal true allows.
 */
async function runHostMiddleware(component) {
  if (!hostChains) {
    hostChains = {}

    for (const route of manifest().routes) {
      if (route.hostMiddleware?.length) hostChains[route.component] = route.hostMiddleware
    }
  }

  const names = hostChains[component] ?? []

  if (names.length === 0) return

  if (!currentHost) {
    throw new Error(
      'Route ' + component + ' declares host middleware (' + names.join(', ') +
        ') but no host callable is installed, so it cannot be checked.',
    )
  }

  const answer = await currentHost(HOST_MIDDLEWARE_FN, names)

  // Anything other than a literal true. A host answering null, undefined, a
  // string, or an object it happened to build on the way to an error is not
  // saying yes.
  if (answer !== true) {
    throw new Error('Host middleware refused ' + component + ' (' + names.join(', ') + ').')
  }
}


async function runMiddleware(component: string, props: Record<string, unknown> = {}): Promise<void> {
  await runHostMiddleware(component)

  // Read from the route table rather than passed in, so every render path is
  // covered by construction and no host has to remember to forward them.
  if (!middlewareChains) {
    middlewareChains = {}

    for (const route of manifest().routes as { component: string; middleware?: string[] }[]) {
      if (route.middleware?.length) middlewareChains[route.component] = route.middleware
    }

    // Api routes too. They are keyed by the module name rather than a
    // component, but the chain above them is the same one the pages beside
    // them run.
    for (const api of (manifest().apis ?? []) as { name: string; middleware?: string[] }[]) {
      if (api.middleware?.length) middlewareChains[api.name] = api.middleware
    }
  }

  for (const name of middlewareChains[component] ?? []) {
    const guard = components[name]

    // A declared guard that is not in the bundle is not "no guard" — it is a
    // check that silently does not happen, which is the same reasoning the
    // host applies when the engine cannot run middleware at all. Currently
    // unreachable, because the chain and the component map come from one
    // discovery pass; it is one refactor away from being reachable, and this
    // is the place that has to fail closed.
    if (!guard) {
      throw new Error(
        'Route middleware ' + name + ' is declared for ' + component + ' but is not in the bundle.',
      )
    }

    // Sequential and awaited, outermost first: an outer guard refusing means
    // the inner one should never have been asked.
    await guard(props)
  }
}

// SPA-navigation Flight stream (worker: rsc-stream).
/**
 * Run a route's middleware without rendering anything.
 *
 * For a host serving a page it did not render: a frozen page is read from disk
 * and never touches the engine, so the check has to be asked for. Refusing
 * throws, exactly as it does mid-render.
 */
export async function runRouteMiddleware(component: string, props: Record<string, unknown> = {}): Promise<void> {
  applyHost()

  return runMiddleware(component, props)
}

export async function handleRscStream(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  slotOverrides: Record<string, SlotOverride> = {},
  from = 0,
  pageKey = '',
): Promise<{ stream: ReadableStream; clientChunks: unknown; segmentDepth: number }> {
  applyHost()

  // The host proposes how much the client already has; the engine decides what
  // is actually safe to skip and reports back what it rendered.
  const start = segmentStart(from, layouts, parallelSlots, slotOverrides)

  // Before anything below them is rendered, never after.
  await runMiddleware(component, props)

  return {
    stream: renderToReadableStream(
      await renderTree(component, props, layouts, loadings, parallelSlots, slotOverrides, start, pageKey),
      { onError: flightOnError },
    ),
    clientChunks: {},
    segmentDepth: start,
  }
}

/**
 * The digest React sends to the client in place of a server error's message.
 *
 * A redirect thrown after the shell has flushed has no header left to travel
 * in — the status line is already sent. React transmits a digest for every
 * server error, in production as well as development, so the destination
 * rides there and the client's boundary performs it.
 *
 * redirectDigest is imported by the generated entry, at the top of this
 * template. An import added to this file instead compiles and bundles without
 * complaint, and then throws at render time against a name that is not there.
 *
 * Returning undefined leaves React's own behaviour alone for everything else.
 */
function flightOnError(error: unknown): string | undefined {
  const digest = redirectDigest(error) ?? notFoundDigest(error)

  if (digest) return digest

  console.error('[rsc-kit]', error)

  return undefined
}

// Initial-load HTML stream + hydration payload (worker: rsc-html-stream).
export async function handleRscHtmlStream(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  slotOverrides: Record<string, SlotOverride> = {},
  nonce?: string,
  pageKey = '',
  bootstrap = true,
): Promise<{ htmlStream: ReadableStream; rscPayloadPromise: Promise<string>; clientChunks: unknown }> {
  applyHost()
  await runMiddleware(component, props)
  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, slotOverrides, 0, pageKey, bootstrap),
    { onError: flightOnError },
  )
  const [forHtml, forPayload] = flight.tee()
  const rscPayloadPromise = new Response(forPayload).text()
  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsr(forHtml, nonce, undefined, bootstrap)
  return { htmlStream, rscPayloadPromise, clientChunks: {} }
}

/**
 * Finish a shell that was frozen at build time.
 *
 * The render is an ordinary one — real host, real data, middleware included —
 * and the postponed state decides what of it actually reaches the wire. React
 * skips everything the shell already emitted and writes only the boundaries it
 * could not finish then.
 *
 * bootstrap is deliberately false. The shell shipped the bootstrap script; a
 * second one would boot the client runtime twice.
 */
export async function handleRscResume(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  slotOverrides: Record<string, SlotOverride> = {},
  postponed: unknown = null,
  nonce?: string,
  pageKey = '',
): Promise<{ htmlStream: ReadableStream }> {
  applyHost()
  await runMiddleware(component, props)

  // The tree must be shaped exactly as it was when the shell was frozen, or
  // React cannot line the resumed segments up with the slots left for them:
  //
  //   Couldn't find all resumable slots by key/index during replaying.
  //   The tree doesn't match so React will fallback to client rendering.
  //
  // Hence \`true\` here rather than false. It reads like it would emit a second
  // bootstrap script, and it does not — resume() takes no bootstrap content at
  // all, so the shell's remains the only one. What this flag actually decides
  // is whether the tree carries its SegmentBoundary, and the shell's did.
  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, slotOverrides, 0, pageKey, true),
    { onError: flightOnError },
  )

  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsrResume(flight, postponed, nonce)

  return { htmlStream }
}

// Server action (worker: rsc-action).
/** The page an action was invoked from, so what it invalidated can be rendered. */
interface PageContext {
  component: string
  props: Record<string, unknown>
  layouts: LayoutEntry[]
  loadings: string[]
  parallelSlots: Record<string, string>
  /**
   * The sections this route declares, which is what bounds a revalidate.
   *
   * Optional only because a host built against an older manifest may not send
   * it; absent, no named section can be revalidated at all. Refusing is the
   * safe reading — the alternative is the registry, which holds every section
   * in the app.
   */
  sections?: string[]
}

/**
 * Render one thing an action said it invalidated.
 *
 *   'all'   the whole document, layouts included
 *   'page'  everything below the layouts, which stay as they are
 *   <slot>  a single parallel slot, by the name its directory gave it
 *
 * A slot is the only unit smaller than a page the server can name, which is
 * why two tables have to be slots to be refreshed apart from each other.
 */
async function renderRevalidated(target: string, page: PageContext): Promise<unknown> {
  // Every target below 'all' renders without the layout chain above it, which
  // is the same skip a navigation performs and needs the same guard run.
  await runMiddleware(page.component, page.props)

  if (target === 'all' || target === 'page') {
    return renderTree(
      page.component,
      page.props,
      page.layouts,
      page.loadings,
      page.parallelSlots,
      {},
      target === 'all' ? 0 : page.layouts.length,
      '',
    )
  }

  // A named region first: it is the lighter of the two, and the one a page
  // reaches for when it only wants part of itself refreshed.
  //
  // Scoped to the sections this route declares. The registry is a module-level
  // map keyed by name, and the generated entry imports every component in the
  // app eagerly, so a name-keyed registry holds every section in the app by the
  // time a request arrives — and two pages may legitimately both call theirs
  // 'stats', where the last one loaded wins.
  //
  // So the target is resolved through the module this route declares, not
  // through a shared map: the manifest says which section files belong to this
  // page, the components map turns one into its module, and section() left the
  // unwrapped component on the export. Identity, rather than string matching.
  //
  // Read from the manifest rather than from the message. The host is not the
  // adversary here, but the route table is build-time truth and already in this
  // bundle, so there is no reason to depend on a field a host has to remember
  // to send — one that forgot would be silently unprotected.
  const owner = manifest().routes.find((route: any) => route.component === page.component)
  const declared: string[] = owner?.sections ?? page.sections ?? []

  // A target of orders names the file app/ledger/orders.section. Matched on
  // that stem, so a target cannot reach a sibling by suffix.
  const path = declared.find((name: string) => name.split('/').pop() === target + '.section')
  const Section = path ? sectionComponent(components[path]) : undefined

  // No throw here: the target may be a slot, which the branch below resolves.
  // A name that is a section of some *other* page simply does not match, falls
  // through, and is refused there — where the error can name both kinds.

  if (Section) {
    // The component, not the wrapper section() returned. The client replaces
    // what is inside the boundary, so sending the wrapper would nest a new
    // boundary inside the old one on every refresh.
    return createElement(Section, page.props)
  }

  // hasOwn, so a target of __proto__ or constructor names nothing.
  const slotComponent = Object.hasOwn(page.parallelSlots, target)
    ? page.parallelSlots[target]
    : undefined

  if (!slotComponent) {
    throw new Error(
      'Cannot revalidate ' + target + ': no section or slot of this page by that name. ' +
        'Sections: ' +
        (declared.map((n: string) => n.split('/').pop()!.replace('.section', '')).join(', ') ||
          'none') +
        '. Slots: ' +
        (Object.keys(page.parallelSlots).join(', ') || 'none'),
    )
  }

  const SlotComp = components[slotComponent]

  if (!SlotComp) throw new Error('Unknown RSC component: ' + slotComponent)

  return createElement(SlotComp, {
    params: Promise.resolve(page.props),
    searchParams: pageSearchParams(),
  })
}

/**
 * Answer one read.
 *
 * Only functions declared with query() are reachable. The id comes off the url,
 * and every registered server action has one — without the mark, this address
 * would invoke mutations over GET, for anyone who can fetch it.
 */
export async function handleQuery(
  id: string,
  args: string,
  report?: (error: unknown) => string,
): Promise<
  | { stream: ReadableStream; cacheControl: string }
  | { status: number; message: string; errors?: Record<string, string[]> }
  | null
> {
  applyHost()

  let fn: unknown

  try {
    fn = await loadServerAction(id)
  } catch {
    return null
  }

  // Null for both, deliberately. Saying "that exists but is not a query" tells
  // whoever is probing this endpoint which ids are real actions, and the ids
  // are stable across a build.
  if (!isQuery(fn)) return null

  const decoded = (await decodeReply(args)) as unknown[]

  // Awaited here rather than handed to the renderer as a promise, so a refusal
  // is still a status line rather than an error row inside a 200. React strips
  // a thrown message in production, so a query that rejected mid-stream would
  // reach the browser as "an error occurred" with the fields gone.
  let result: unknown

  try {
    result = await (fn as (...a: unknown[]) => unknown)(...decoded)
  } catch (error) {
    if (isQueryValidationError(error)) {
      return { status: 422, errors: error.errors, message: error.message }
    }

    return { status: 500, message: report ? report(error) : 'Query failed.' }
  }

  return {
    stream: renderToReadableStream(result, {
      onError: (error: unknown) => (report ? report(error) : 'Query failed.'),
    }),
    cacheControl: queryCacheControl(fn),
  }
}

export async function handleAction(
  actionId: string,
  body: string | FormData | Uint8Array,
  contentType = 'text/plain',
  page?: PageContext,
  takeRevalidated?: () => string[],
): Promise<{ stream: ReadableStream }> {
  applyHost()

  // Every body arrives as bytes on its own socket frame — an upload because it
  // has to, the rest because the transport does not special-case them. What
  // differs is what they decode to: multipart is FormData, everything else is
  // the text encodeReply produced.
  //
  // Treating only multipart as bytes and leaving the rest empty is a silent
  // failure: the action runs with no arguments at all.
  let decodable: string | FormData

  if (typeof body === 'string') {
    decodable = body
  } else if (contentType.includes('multipart/form-data')) {
    decodable = await new Response(body, { headers: { 'Content-Type': contentType } }).formData()
  } else {
    decodable = new TextDecoder().decode(body)
  }

  // Checked before decoding, because React's decoder does not fail cleanly on
  // a malformed payload: the parse error is raised inside a chunk nobody
  // awaits, so the promise decodeReply returned never settles. The caller
  // cannot catch that — no try/catch anywhere sees it — and the request hangs
  // while the rejection escapes. On Node, whose default is to exit on an
  // unhandled rejection, that is the whole process, reachable by anyone who
  // can post to the action endpoint.
  //
  // A reply that is not multipart is the JSON model encodeReply produced, so
  // parsing it is both the check and the whole of it.
  if (typeof decodable === 'string') {
    try {
      JSON.parse(decodable)
    } catch {
      throw new Error('Malformed server action body: expected the payload encodeReply produces.')
    }
  }

  const args = (await decodeReply(decodable)) as unknown[]
  const action = await loadServerAction(actionId)

  // A query reached the ACTION endpoint, which means it was called directly
  // rather than through fetchQuery — so it went out as a POST and none of the
  // reasons it was marked a read apply to it. It still works, which is the
  // problem: nothing else would ever mention it. Only in development, and only
  // a warning, because the call is not wrong, just not what was asked for.
  if (isQuery(action) && import.meta.env?.DEV) {
    console.warn(
      '[rsc-kit] ' + actionId + ' is a query but was called directly, so it was sent as a POST. ' +
        'Call it through fetchQuery() to send a GET.',
    )
  }

  // A plain "use server" function that threw fieldErrors() gets the same
  // treatment createActionClient gives its handlers: the throw becomes the
  // returned { validationErrors } that <Form> reads. Left thrown, React
  // serialises the rejection opaquely — production strips the message — and the
  // fields it named never reach the browser.
  let result: unknown

  try {
    result = await (action as (...a: unknown[]) => unknown)(...args)
  } catch (error) {
    if (!isActionValidationError(error)) throw error

    result = { validationErrors: error.errors }
  }

  // Read after the action has run: what it invalidated is only known once its
  // host calls have been made. Rendering here rather than telling the browser
  // to ask is the whole point — the answer carries what went stale with it.
  const targets = takeRevalidated?.() ?? []

  if (targets.length === 0 || !page) {
    return { stream: renderToReadableStream(result) }
  }

  const revalidated: Record<string, unknown> = {}

  for (const target of targets) {
    revalidated[target] = await renderRevalidated(target, page)
  }

  // Marked, so an action whose own result happens to be an object with a
  // 'result' key is not mistaken for this envelope.
  return { stream: renderToReadableStream({ __rscRevalidated: revalidated, result }) }
}

export async function resolveMetadata(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
): Promise<Record<string, unknown> | null> {
  const pageEntry = metadataMap[component]
  const page: Record<string, unknown> = pageEntry
    ? (pageEntry.generate
        // The same awaitables the page receives. Resolved rather than
        // suspending, even during the probe: a title has to be produced for
        // the shell, and there is no fallback for a <title>.
        ? ((await pageEntry.generate({
            params: Promise.resolve(props),
            searchParams: pageSearchParams(),
          })) ?? {})
        : { ...(pageEntry.static ?? {}) })
    : {}

  // Non-title metadata: layout defaults (outer→inner), page overrides.
  //
  // other merges per key rather than being replaced, so a page adding one
  // custom tag keeps the ones its layout set. Assigning it like any other key
  // would mean a root layout's theme-color disappearing from every page that
  // happened to declare one of its own.
  const merged: Record<string, unknown> = {}
  const other: Record<string, unknown> = {}

  const take = (from: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(from)) {
      if (k === 'title') continue
      if (k === 'other') Object.assign(other, v as Record<string, unknown>)
      else merged[k] = v
    }
  }

  for (const l of layouts) {
    const s = metadataMap[l.component]?.static

    if (s) take(s as Record<string, unknown>)
  }

  take(page)

  if (Object.keys(other).length > 0) merged.other = other

  // Title: the page title with the NEAREST layout title.template applied; if the
  // page has no title, the nearest layout default/string title.
  let title: string | undefined = typeof page.title === 'string' ? page.title : undefined
  for (let i = layouts.length - 1; i >= 0; i--) {
    const lt = metadataMap[layouts[i].component]?.static?.title as
      | string | { template?: string; default?: string } | undefined
    if (lt && typeof lt === 'object') {
      if (title != null && lt.template) { title = lt.template.replace('%s', title); break }
      if (title == null && lt.default) { title = lt.default; break }
    } else if (title == null && typeof lt === 'string') { title = lt; break }
  }
  if (title != null) merged.title = title

  return Object.keys(merged).length ? merged : null
}

// Buffered render (worker: rsc / rscWithoutCallbacks — used at prerender time).
export async function handleRsc(
  component: string,
  props: Record<string, unknown> = {},
  _callbackSocket: string | null = null,
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  from = 0,
  pageKey = '',
  bootstrap = true,
  canReachHost = true,
): Promise<{ body: string; rscPayload: string; clientChunks: unknown; usedDynamicApis: boolean; dynamicBecause: string[]; clientComponents: string[]; serverReferences: boolean }> {
  applyHost()

  // A build renders this with no host installed, so every rpc() has to suspend
  // rather than answer — which is what marks the page as needing a request.
  // Without the probe those calls found no host at all, and the page was
  // frozen holding whatever undefined rendered to.
  //
  // Defaults to true because the other caller is an interception, which runs
  // at request time with a real host and must not be probed.
  let usedDynamicApis = false
  const hostCalls: string[] = []

  const probe = (...args: unknown[]) => {
    usedDynamicApis = true

    // The name it was called with, so the build can say rpc("getUser") rather
    // than "this page reached for the host" and leave you to find which call.
    const name = typeof args[0] === 'string' ? args[0] : null
    const said = name ? 'rpc(' + JSON.stringify(name) + ')' : 'rpc()'

    if (!hostCalls.includes(said)) hostCalls.push(said)

    return new Promise<never>(() => {})
  }

  // Not a generic arrow function: this file is generated as .tsx, where <T>
  // parses as JSX and the build fails on a tag it cannot close.
  const runWith = canReachHost
    ? (fn: () => Promise<unknown>) => fn()
    : (fn: () => Promise<unknown>) => probeHost.run(probe, fn)

  // renderTree (not bare buildElement) so the prerendered Flight payload carries
  // the same <title>/<meta> elements the live SPA payload does.
  const tree = await runWith(() =>
    renderTree(component, props, layouts, loadings, parallelSlots, {}, from, pageKey, bootstrap),
  )

  const flight = renderToReadableStream(tree, { onError: flightOnError })
  const [forHtml, forPayload] = flight.tee()
  const rscPayload = await new Response(forPayload).text()
  const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
  const htmlStream = await ssr.handleSsr(forHtml, undefined, undefined, bootstrap)
  const body = await new Response(htmlStream).text()

  return {
    body,
    rscPayload,
    clientChunks: {},
    usedDynamicApis,
    // Client reference rows name the components the browser has to run. Shipping
    // no runtime would leave them as inert markup, so the host refuses — and
    // says which components forced the decision, since they are usually in a
    // shared layout rather than the page itself.
    clientComponents: clientReferenceNames(rscPayload),
    serverReferences: hasServerReference(rscPayload),
  }
}

/**
 * Names of the client components a payload references.
 *
 * A row reads 1:I["<module>",[],"Name",1]; the fourth quoted field is the
 * export. Parsed by splitting rather than matching, because this function is
 * emitted into a template literal where a regex would need double escaping.
 */
function clientReferenceNames(payload: string): string[] {
  const names = new Set<string>()

  // A string React has already sent is referenced by row - "$1" for the
  // string in row 1 - rather than repeated. The export name of a client
  // reference is exactly the kind of string that repeats, so it arrives that
  // way and has to be looked up, or the refusal names a component "$1".
  const strings = new Map<string, string>()

  for (const line of payload.split('\\n')) {
    const match = /^(\\d+):"(.*)"$/.exec(line)
    if (match) strings.set('$' + match[1], match[2]!)
  }

  for (const row of payload.split(':I[').slice(1)) {
    const name = row.split('"')[3]
    if (name) names.add(strings.get(name) ?? name)
  }

  return [...names]
}

/**
 * Whether the payload carries a server reference - an action handed to a
 * form or a client component. A row of {"id":"...","bound":...} is one,
 * however it is pointed at ($F for a function prop, $h for a form action).
 * A page with one needs the runtime to submit it.
 */
export function hasServerReference(payload: string): boolean {
  return /^\\d+:\\{"id":"[^"]+","bound":/m.test(payload)
}

// Flight payload only (worker: rsc-payload — build-time).
//
// The segment variant of a prerendered route needs the payload and nothing
// else. handleRsc also renders the HTML, which for that variant is built and
// thrown away — a whole SSR pass per route for output nobody reads.
/**
 * Render one thing on its own, for a client asking to refresh it.
 *
 * The same targets an action can mark. This is the path for a refresh nobody
 * mutated anything to earn — a button, a poll, a websocket saying the orders
 * table moved.
 */
export async function handleRscRevalidate(
  target: string,
  page: PageContext,
): Promise<{ rscPayload: string }> {
  applyHost()

  const flight = renderToReadableStream(await renderRevalidated(target, page))

  return { rscPayload: await new Response(flight).text() }
}

export async function handleRscPayload(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  from = 0,
  pageKey = '',
): Promise<{ rscPayload: string }> {
  applyHost()

  const flight = renderToReadableStream(
    await renderTree(component, props, layouts, loadings, parallelSlots, {}, from, pageKey),
    { onError: flightOnError },
  )

  return { rscPayload: await new Response(flight).text() }
}

// PPR shell + classification (worker: rsc-ppr-shell — build-time).
//
// rpc() is replaced by a probe that records the call and never resolves, so
// every subtree depending on per-request data stays suspended while everything
// static renders normally. Whatever React has flushed when the deadline passes
// IS the shell: layouts, static markup, and Suspense fallbacks.
//
// The two flags this returns are what the prerender pipeline classifies on:
//   usedDynamicApis — the page touched rpc(), so it cannot be frozen whole
//   timedOut        — the render never finished, i.e. it is still waiting on
//                     data, so only the shell is safe to cache
// A page that sets neither is genuinely static and can be prerendered fully.
const PPR_SHELL_TIMEOUT_MS = Number(process.env.RSC_PPR_TIMEOUT_MS || 2000)

export async function handleRscPprShell(
  component: string,
  props: Record<string, unknown> = {},
  layouts: LayoutEntry[] = [],
  loadings: string[] = [],
  parallelSlots: Record<string, string> = {},
  // The url this shell will be served for, when it is served for exactly one.
  // Empty for a parameterised route, whose shell is shared across every url it
  // matches and therefore cannot carry one.
  pageKey = '',
  // How long to let the render run before taking whatever has flushed.
  //
  // A parameter because not every caller is asking the same question. Deciding
  // what a page's shell IS needs the full budget — the point is to wait out
  // everything that can resolve. Asking whether anything paints at all without
  // a root fallback is a boolean about the first flush, and a page that paints,
  // paints immediately: giving that the same budget spends two seconds per
  // route to learn nothing the first millisecond did not say.
  budgetMs = PPR_SHELL_TIMEOUT_MS,
  // Whether this build can answer host calls.
  //
  // False is the old and still the usual answer: the stub suspends, and a page
  // reaching for its host becomes a shell rather than freezing data fetched
  // once at build time.
  //
  // A host that opened a callback socket for the build says true, and then the
  // call is made and its answer stored. That is the only way a page whose data
  // lives in the host can be static at all, since a host call is its only route
  // to that data — and
  // connection() is how such a page opts back out.
  //
  // Asked of the caller rather than read from whatever host happens to be
  // installed, because those are different statements: a test that installed
  // one is not a build that can reach the host.
  canReachHost = false,
): Promise<{ shellHtml: string; clientChunks: unknown; timedOut: boolean; usedDynamicApis: boolean; error?: string }> {
  // Deliberately no middleware here. The probe is asking whether the content is
  // the same for everyone, which is a question about the page. Whether a
  // particular caller may see it is a question about the request, and there is
  // no request at build time — running a guard here would refuse every time
  // and make every guarded route dynamic for the wrong reason.
  let usedDynamicApis = false

  applyHost()

  const probe = (..._args: unknown[]) => {
    usedDynamicApis = true

    // Never resolves: the awaiting component suspends and React renders its
    // Suspense fallback into the shell instead of the real content.
    return new Promise<unknown>(() => {})
  }

  let shellHtml = ''
  let completed = false
  let error: string | undefined
  let postponed: unknown = null

  // The budget, declared before the error handler that consults it.
  const controller = new AbortController()
  const budget = setTimeout(() => controller.abort(), budgetMs)

  // Anything that failed while producing this shell.
  //
  // A rejection inside a Suspense boundary does NOT reach the caller: React
  // catches it, keeps the fallback, and the render goes on to finish. So the
  // probe looked like a page that had nothing left to do — no postponed state,
  // no thrown error — and the fallback was frozen as a finished static page.
  // A database the build machine cannot reach produced a permanently loading
  // page, stored, with the build reporting success.
  let renderFailure: string | undefined

  const noteFailure = (e: unknown, info?: { componentStack?: string }): string | undefined => {
    const digest = redirectDigest(e)

    // A redirect is a classification here, not a failure.
    if (digest) return digest

    // A read the server could not answer, caught at a boundary: the fallback
    // there is what gets stored. Noted with its component so the build can
    // say so on the route's line; the digest goes into the document for the
    // browser to recognise.
    if ((e as { digest?: string } | null)?.digest === 'rsc-kit:search-params-fallback') {
      const where = /at ([A-Z][\\w$]*)/.exec(info?.componentStack ?? '')?.[1]
      noteCaughtRead('useSearchParams()' + (where ? ' in ' + where : ''))
      return 'rsc-kit:search-params-fallback'
    }

    // Every probe ends by aborting, so React reports that abort. Asked of the
    // signal rather than matched against the message: a string test would be a
    // guess about wording, and would quietly stop working when React changed it.
    if (controller.signal.aborted) return undefined

    renderFailure ??= e instanceof Error ? e.message : String(e)
    console.error('[rsc-kit]', e)

    return undefined
  }

  // The budget is an abort signal rather than a race. \`prerender\` resolves when
  // it is aborted, handing back both what flushed and where it stopped, so there
  // is nothing left to cancel by hand and no window in which the render is still
  // going after the caller has moved on.

  // Everything the render does happens inside the scope, so the stand-in host
  // travels with it rather than with the process.
  const runWith = canReachHost
    ? (fn: () => Promise<void>) => fn()
    : (fn: () => Promise<void>) => probeHost.run(probe, fn)

  const produce = runWith(async () => {
    try {
      // Params settle only when this probe is for one concrete url. A route
      // that listed its urls is being rendered for one of them, so the page
      // can be frozen whole; a route that listed none is being rendered for
      // the pattern, where any value would be an invention.
      const tree = await renderTree(
        component,
        props,
        layouts,
        loadings,
        parallelSlots,
        {},
        0,
        pageKey,
        true,
        pageKey ? Promise.resolve(props) : new Promise(() => {}),
      )
      // Quiet about a redirect: during the probe it is a classification, not
      // a failure, and React would otherwise print a stack for every one.
      const flight = renderToReadableStream(tree, { onError: noteFailure })
      const ssr = await (import.meta as any).viteRsc.loadModule('ssr', 'index')
      // The flight stream stays open across this. A Flight stream that has
      // closed tells the decoder the connection ended, so the boundary waiting
      // on it errors rather than staying pending — and an errored boundary is
      // finished, not postponed: it comes back null and there is nothing left
      // to resume from.
      const prerendered = await ssr.handleSsrPrerender(flight, {
        signal: controller.signal,
        onError: noteFailure,
      })

      postponed = prerendered.postponed

      const reader = prerendered.prelude.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        shellHtml += decoder.decode(value, { stream: true })
      }

      completed = true
    } catch (e: any) {
      error = e?.message ?? String(e)
    }
  })

  await produce
  clearTimeout(budget)

  // timedOut used to mean the stopwatch ran out. It now means React has
  // boundaries it could not finish — the thing the caller was always asking
  // about, and exact rather than inferred: a page that finishes inside the
  // budget says so by postponing nothing.
  return {
    shellHtml,
    clientChunks: {},
    timedOut: postponed !== null,
    usedDynamicApis,
    error,
    postponed,
    renderFailure,
  }
}

/**
 * What \`vite dev\` serves.
 *
 * @vitejs/plugin-rsc's dev server calls this module's default export for every
 * request, so implementing it is the whole of dev mode: the same handler the
 * production server builds, over the same route table, against modules Vite
 * re-evaluates on edit. Nothing is prebuilt, so there is no build to keep in
 * step and no NODE_ENV to match — this is React's development build because
 * Vite is running in development.
 *
 * Assets are deliberately absent: Vite serves its own.
 *
 * Frozen pages are absent *in development* — a frozen page is a build
 * artifact, and serving one here would hand back the last build's HTML for a
 * file just edited. Under Nitro this same file is also the production entry,
 * and reading that reason as applying to both is what left every built Nitro
 * server rendering live pages it had already frozen. The gate is the mode, not
 * the file.
 */
${fallbackOrigin ? FALLBACK_CONSTS.replace("__ORIGIN__", JSON.stringify(fallbackOrigin)) : ""}${NITRO_HOST_CALLS}
let devHandler: ((request: Request) => Promise<Response | null>) | null = null

export default async function handler(request: Request): Promise<Response> {
  try {
    return await serve(request)
  } catch (error) {
    // Vite re-optimised a server pre-bundle under this render. The condition
    // is over already; the page is asked to load again.
    if (import.meta.env.DEV && isOutdatedOptimizedDep(error)) return outdatedDepResponse(request)

    throw error
  }
}

async function serve(request: Request): Promise<Response> {
  installHostCallsOnce()

  devHandler ??= createRscHandler({
    engine: {
      manifest,
      getStaticParams,
      installHostFn,
      handleRsc,
      handleRscStream,
      handleRscHtmlStream,
      handleRscRevalidate,
      handleRscPayload,
      handleRscPprShell,
      handleRscResume,
      handleAction,
      handleQuery,
      handleApiRoute,
      resolveMetadata,
      runRouteMiddleware,
    } as never,
${NITRO_HANDLER_OPTIONS}${NITRO_PRERENDERED}    maxActionBody: ${maxActionBody === undefined ? "undefined" : String(maxActionBody)},
  })

${fallbackOrigin ? FALLBACK_BODY : "  return (await devHandler(request)) ?? (await notFound(request))\n"}}

/**
 * The page for a url nothing answers.
 *
 * Rendered through its layout chain like any other page, so the 404 a visitor
 * sees is the app rather than a bare string — and returned with a 404, because
 * a page that says "not found" under a 200 is a page search engines index.
 *
 * Without a not-found.tsx this is the string it always was.
 */
async function notFound(request: Request): Promise<Response> {
  ${
    notFoundComponent
      ? `
  // A navigation, not a document: answer with the not-found tree as a
  // payload, at the depth the client already holds, so the router renders
  // it in place - the layout stays, the url changes, nothing reloads. The
  // status is still 404; a payload is a payload whatever it says.
  if (request.headers.get('X-RSC')) {
    try {
      const chain = ${JSON.stringify(notFoundLayouts)}
      const from = sharedDepth(request.headers.get('X-RSC-Segments'), chain)
      const { rscPayload } = await handleRscPayload(
        ${JSON.stringify(notFoundComponent)},
        {},
        ${JSON.stringify(notFoundLayouts.map((component) => ({ component, props: {} })))},
        [],
        {},
        from,
        '/404',
      )

      return new Response(rscPayload, {
        status: 404,
        headers: {
          'Content-Type': 'text/x-component; charset=utf-8',
          'X-RSC-Segment-Depth': String(from),
          'X-RSC-Layouts': chain.join(','),
          'Cache-Control': 'no-store',
          Vary: 'X-RSC',
        },
      })
    } catch {
      // Fall through to the document answer below.
    }
  }

  try {
    const { htmlStream } = await handleRscHtmlStream(
      ${JSON.stringify(notFoundComponent)},
      {},
      ${JSON.stringify(notFoundLayouts.map((component) => ({ component, props: {} })))},
      [],
      {},
      {},
      undefined,
      '/404',
    )

    return new Response(htmlStream, {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    // A 404 page that throws is still a 404. Falling back rather than
    // answering 500 keeps the status honest about what happened.
  }
  `
      : ""
  }
  return new Response('Not found', { status: 404 })
}
`;
}

function generateEntrySsr(): string {
  const devUrls = join(packageDir, "devUrls");
  const request = join(packageDir, "request");
  const fallbackReport = join(packageDir, "js/fallbackReport");

  return `// GENERATED by rscKit() — do not edit.
import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr'
import { renderToReadableStream, resume } from 'react-dom/server.edge'
import { prerender } from 'react-dom/static.edge'
import { rewriteViteDevUrlStream } from ${JSON.stringify(devUrls)}
import { noteFallback } from ${JSON.stringify(request)}
import { caughtByLoading } from ${JSON.stringify(fallbackReport)}

// Set only by the dev server. @vitejs/plugin-rsc emits its bootstrap and CSS
// links root-relative in dev, which would send the browser to the host for
// modules only Vite can answer — see devUrls.ts.
const DEV_ORIGIN = ${JSON.stringify(devOrigin)}

export async function handleSsr(
  rscStream: ReadableStream,
  nonce?: string,
  onError?: (error: unknown) => void,
  bootstrap = true,
): Promise<ReadableStream> {
  const root = await createFromReadableStream(rscStream)

  // Without the bootstrap the page ships no client runtime at all: no React,
  // no Flight client, no router. HTML only. A page with nothing interactive on
  // it has no use for 70kB of hydration.
  const bootstrapScriptContent = bootstrap
    ? await (import.meta as any).viteRsc.loadBootstrapScriptContent('index')
    : undefined

  // Without an onError handler React rejects each abortable task on its own,
  // and those rejections surface as unhandled — noisy for the PPR shell render,
  // which aborts on purpose once it has the shell.
  const html = await renderToReadableStream(root as any, {
    bootstrapScriptContent,
    nonce,
    // The query-string fallback is the designed path for a stored page, and
    // its digest is what lets the client tell it from a fault on hydration;
    // returned here so React writes it into the document.
    onError: onError ?? ((error: unknown, info?: { componentStack?: string }) => {
      const digest = (error as { digest?: string } | null)?.digest
      if (digest === 'rsc-kit:search-params-fallback') {
        // The component is the first frame of React's stack. Noted on the
        // request so the build attaches it to the route; printed as one line,
        // not a stack, so the dev server says which boundary the build wants.
        const where = /at ([A-Z][\\w$]*)/.exec(info?.componentStack ?? '')?.[1]
        noteFallback('useSearchParams()' + (where ? ' in ' + where : ''))
        // Under a boundary the developer wrote, nothing to say. With nothing
        // closer than a loading.tsx, one line: the whole segment is the
        // fallback until the query arrives.
        if (caughtByLoading(info?.componentStack)) {
          console.error(
            '[rsc-kit] ' + (where ? where + ': ' : '') +
            'useSearchParams() was read on the server with nothing closer than a loading.tsx, so the whole ' +
            'segment shows that fallback until the query arrives. A <Suspense> around the component that reads ' +
            'keeps the rest of the page painted.',
          )
        }
        return digest
      }
      console.error('[rsc-kit:ssr]', error)
    }),
  })

  return DEV_ORIGIN ? rewriteViteDevUrlStream(html, DEV_ORIGIN) : html
}

/**
 * The same render, stopped at the first thing it cannot finish.
 *
 * \`renderToReadableStream\` and then cancelling gives you the bytes that
 * flushed and nothing else — the render is *aborted*, so React has no record of
 * where it got to. \`prerender\` aborts the same way but hands back
 * \`postponed\`: enough state to pick the render back up later, against data
 * that did not exist at build time.
 *
 * The rscStream must still be OPEN when this returns. A Flight stream that has
 * closed tells the decoder the connection ended, so the boundary waiting on it
 * *errors* rather than staying pending — and an errored boundary is not
 * postponed, it is finished. \`postponed\` comes back null and there is nothing
 * to resume.
 */
export async function handleSsrPrerender(
  rscStream: ReadableStream,
  options: { nonce?: string; bootstrap?: boolean; signal?: AbortSignal } = {},
): Promise<{ prelude: ReadableStream; postponed: unknown }> {
  const root = await createFromReadableStream(rscStream)

  const bootstrapScriptContent =
    options.bootstrap === false
      ? undefined
      : await (import.meta as any).viteRsc.loadBootstrapScriptContent('index')

  const { prelude, postponed } = await prerender(root as any, {
    bootstrapScriptContent,
    nonce: options.nonce,
    signal: options.signal,
    // Aborting is how this ends, so React's report of it is not news. A read
    // caught at a boundary is: the build attaches it to the route.
    onError: (error: unknown, info?: { componentStack?: string }) => {
      if ((error as { digest?: string } | null)?.digest !== 'rsc-kit:search-params-fallback') return
      const where = /at ([A-Z][\\w$]*)/.exec(info?.componentStack ?? '')?.[1]
      noteFallback('useSearchParams()' + (where ? ' in ' + where : ''))
      return 'rsc-kit:search-params-fallback'
    },
  })

  return {
    prelude: DEV_ORIGIN ? rewriteViteDevUrlStream(prelude, DEV_ORIGIN) : prelude,
    postponed: postponed ?? null,
  }
}

/**
 * Pick a build-time render back up, against data that exists now.
 *
 * Emits ONLY what the shell left unfinished — the hidden segments plus React's
 * own script to move them into place. It is meant to be concatenated after the
 * shell, and it carries no bootstrap of its own: the shell already shipped one.
 *
 * The swap is done by that inline script, not by hydration, so the holes land
 * even on a page whose JavaScript never loads.
 */
export async function handleSsrResume(
  rscStream: ReadableStream,
  postponed: unknown,
  nonce?: string,
): Promise<ReadableStream> {
  const root = await createFromReadableStream(rscStream)

  const html = await resume(root as any, postponed as any, {
    nonce,
    onError: (error: unknown) => { console.error('[rsc-kit:resume]', error) },
  })

  return DEV_ORIGIN ? rewriteViteDevUrlStream(html, DEV_ORIGIN) : html
}
${SSR_SERVICE}`;
}

/**
 * What Nitro calls this environment through.
 *
 * Nitro addresses each Vite environment as a service and calls fetch on it —
 * `mod = _mod.default || _mod; mod.fetch(req)` — so an entry that exports only
 * named functions is a 500 on every request. The named ones stay: the rsc
 * entry still reaches them through loadModule. This only adds the door Nitro
 * knocks on, and the request goes straight back to the rsc entry, which is the
 * one that owns rendering.
 */
const SSR_SERVICE = `
export default {
  fetch: async (request: Request): Promise<Response> => {
    const rsc = await import.meta.viteRsc.loadModule<{
      default: (request: Request) => Promise<Response>
    }>('rsc', 'index')

    return rsc.default(request)
  },
}
`;

function generateEntryBrowser(): string {
  const clientBootstrap = join(packageDir, "js/createViteRscApp");

  // Only for an exported build, and only what the client needs to work out how
  // much of a page to ask for: a file server sends no headers, so without this
  // every navigation takes the whole document and replaces the root. Inlined
  // rather than fetched, so it costs no request. Omitted entirely otherwise —
  // a server answers this, and shipping a route table to every browser for
  // nothing is a page-weight cost with no benefit.
  const routesForClient = staticPayloads
    ? routeManifest().routes.map((route) => ({
        segments: route.segments,
        layouts: route.layouts,
      }))
    : null;

  const refreshModule = join(packageDir, "js/navigate");

  return `// GENERATED by rscKit() — do not edit.
import { createViteRscApp } from ${JSON.stringify(clientBootstrap)}
import { refresh } from ${JSON.stringify(refreshModule)}

createViteRscApp(document, ${JSON.stringify(interceptManifest())}, ${JSON.stringify(
    {
      staticPayloads: staticPayloads || null,
      routes: routesForClient,
    },
  )})

// A server component is not a module the browser has, so Vite cannot replace
// it the way it replaces a client one. @vitejs/plugin-rsc says so instead:
// when a module in the rsc graph changes it sends this, and re-fetching the
// payload is the update. Without a listener an edit to a page reaches the
// server and stops there, and the browser goes on showing the old render
// until someone reloads by hand.
//
// 'all', not 'page': a layout is a server component too, and refreshing only
// below it would leave an edited layout on screen unchanged. It costs nothing
// extra — a client component below is remounted either way, because the new
// payload carries a fresh reference to its module. Editing that component
// directly is the case where state survives, and that is Fast Refresh doing
// it rather than this.
if (import.meta.hot) {
  import.meta.hot.on('rsc:update', () => {
    void refresh('all')
  })
}
${
  offline
    ? `
// Registered after load rather than during it, so fetching and installing the
// worker competes with nothing the first visit actually needs. The second
// visit is the one it is for.
//
// Not in development: the dev server is the thing you are editing, and a
// worker answering from a cache in front of it turns every edit into a
// question about which copy you are looking at.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // A worker that will not register is not a reason for the page to fail.
      // The app works; it just will not survive being reloaded offline.
    })
  })
}
`
    : ""
}`;
}

/**
 * Intercepted URL patterns, published by the host before the build.
 *
 * The client has to recognise an intercepted link before it asks the server,
 * so the patterns are baked into the browser entry. The host owns the file
 * because it owns route discovery; an absent or unreadable one just means no
 * interception, never a failed build.
 */
/**
 * The intercepted urls the client router has to recognise, in its dialect.
 *
 * Generated here rather than read from a file the host wrote. The host used to
 * discover these because it owned the walk of app/; now the plugin does, and a
 * host writing them meant producing this file before the build that needed it —
 * an ordering that only worked because the two steps happened to be in the
 * right sequence.
 */
function interceptManifest(): Array<{ urlPattern: string; slot: string }> {
  return routeManifest().intercepts.map((entry) => ({
    // The client writes [id] where a Laravel route writes {id}.
    urlPattern:
      "/" +
      entry.segments
        .map((seg) =>
          seg.type === "static" ? seg.value : "[" + seg.value + "]",
        )
        .join("/"),
    slot: entry.slot,
  }));
}

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Extract the body of a file's default-exported function.
 *
 * Only the page component's OWN body matters for the loading.tsx rule — sibling
 * components declared in the same file render behind their own boundaries, so
 * their host calls do not block the route's shell.
 */
function defaultExportBody(source: string): string | null {
  const match = source.match(
    /export\s+default\s+(?:async\s+)?function[^(]*\([^)]*\)\s*{/,
  );
  if (!match) return null;

  // Walk from the opening brace to its match, ignoring braces in strings.
  let depth = 0;
  const start = match.index! + match[0].length - 1;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }

  return null;
}

/**
 * Does the page component's own render block on the host callable?
 *
 * Only an awaited call blocks. Starting a call and handing the promise to a
 * child — for a client component to unwrap with use() inside its own Suspense
 * boundary — lets the page paint immediately and needs no loading.tsx.
 *
 * The check is deliberately syntactic: a call awaited indirectly, through a
 * variable, is not caught. That errs toward letting a build through rather than
 * rejecting a page that is actually fine.
 */
function pageBlocksOnHostCall(source: string): boolean {
  const isAsyncDefault = /export\s+default\s+async\s+function/.test(source);
  if (!isAsyncDefault) return false;

  const body = defaultExportBody(source);

  // Matches `await rpc(`, and the explicitly-qualified forms a typed codebase
  // may use: `await globalThis.rpc(` / `await (globalThis as any).rpc(`.
  const qualifier =
    "(?:\\(\\s*globalThis[^)]*\\)\\s*\\.\\s*|globalThis\\s*\\.\\s*)?";
  const awaited = new RegExp(`\\bawait\\s+${qualifier}${hostGlobal}\\s*[<(]`);

  return body !== null && awaited.test(body);
}

/** Walk up from the page directory to app/ looking for a loading file. */
function hasLoadingInChain(pageDir: string): boolean {
  let dir = pageDir;

  while (dir.startsWith(appDir)) {
    if (findRouteFile(dir, "loading")) return true;
    if (dir === appDir) break;
    dir = dirname(dir);
  }

  return false;
}

/**
 * A route needs loading.tsx only when the PAGE ITSELF blocks — an async default
 * export awaiting the host callable, or the host resolving props dynamically. Both
 * suspend before anything can paint, so without a boundary the user sees a
 * blank screen. A page whose slow work lives in children behind their own
 * <Suspense> already paints a shell and needs nothing.
 */
/**
 * An `error.tsx` has to be a client component.
 *
 * It is rendered inside a React error boundary, which is a class component in
 * the browser, and it is handed a `reset` callback to call. A server component
 * can be neither. Caught here rather than at runtime, where the symptom is a
 * boundary that renders nothing while the error it was written for goes to the
 * console.
 */
function validateErrorBoundaries(): string[] {
  const wrong: string[] = [];

  for (const c of components.values()) {
    if (!c.name.endsWith("/error")) continue;

    const source = readFileSync(c.absPath, "utf-8");

    if (!/^\s*['"]use client['"]/m.test(source)) {
      wrong.push(`  ${relative(projectRoot, c.absPath)}`);
    }
  }

  return wrong;
}

function validateLoadingBoundaries(): string[] {
  const errors: string[] = [];

  for (const c of components.values()) {
    if (!c.name.endsWith("/page") && c.name !== "app/page") continue;

    const pageDir = dirname(c.absPath);
    const source = readFileSync(c.absPath, "utf-8");

    let reason: string | null = null;

    if (pageBlocksOnHostCall(source)) {
      reason = `its default export awaits ${hostGlobal}()`;
    } else {
      const configPath = routeConfig ? join(pageDir, routeConfig.file) : null;

      if (
        routeConfig &&
        configPath &&
        existsSync(configPath) &&
        routeConfig.dynamicPattern.test(readFileSync(configPath, "utf-8"))
      ) {
        reason = `${routeConfig.file} resolves props dynamically`;
      }
    }

    if (reason && !hasLoadingInChain(pageDir)) {
      errors.push(
        `  ${c.name} — ${reason}, but has no loading.tsx in its directory chain`,
      );
    }
  }

  return errors;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

/** Names of plugins that transform JSX and must run after rsc() has split it. */
const JSX_PLUGIN_PATTERN = /react|babel|oxc/i;

/**
 * The server-side stand-in for a client export, made extendable.
 *
 * In the rsc environment plugin-rsc replaces every export of a "use client"
 * module with a stub that throws when called. It emits the stub as an arrow
 * function, and an arrow function has no prototype, so a server module that
 * does `class NullStore extends ReactStore` - base-ui does, with only the
 * base class marked "use client" - dies at the class declaration with
 * "The superclass is not a constructor", on a line nobody wrote, whenever a
 * server component imports the library directly. Next.js allows that import;
 * React's own client references are proxies over a real function.
 *
 * A `function` stub has a prototype, so the declaration succeeds, and the
 * stub still throws - now from `super()`, with its own message - if the
 * class is ever constructed on the server.
 */
const CLIENT_STUB =
  /registerClientReference\(\s*\(\) => \{ throw new Error\("Unexpectedly client reference export '"/g;

function extendableClientReferences(): Plugin {
  return {
    name: "rsc-kit:extendable-client-references",
    enforce: "post",
    applyToEnvironment: (environment) => environment.name === "rsc",
    transform(code) {
      if (!code.includes("Unexpectedly client reference export")) return;

      return {
        code: code.replace(
          CLIENT_STUB,
          'registerClientReference(function () { throw new Error("Unexpectedly client reference export \'"',
        ),
        map: null,
      };
    },
  };
}

/**
 * The worker the dev server serves at /sw.js: it removes the one a production
 * run left on this origin, and the caches with it, then reloads each page it
 * was controlling so they load uncontrolled. Nothing else runs in development.
 */
export const DEV_WORKER = `self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith('rsc-kit-')).map((k) => caches.delete(k)))
    await self.clients.claim()
    const pages = await self.clients.matchAll({ type: 'window' })
    await self.registration.unregister()
    for (const page of pages) page.navigate(page.url).catch(() => {})
  })())
})
`;

/**
 * "use ssr" modules, rewritten for the server-components environment into
 * proxies that call the real module in the ssr environment. See useSsr.ts.
 *
 * Before every other transform, so the cross-environment import this emits
 * is still ahead of plugin-rsc's handling of it - and so the module's own
 * imports, react-dom/server among them, are never resolved here at all.
 */
function useSsrModules(): Plugin {
  return {
    name: "rsc-kit:use-ssr",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "rsc",
    transform(code, id) {
      if (!code.includes("use ssr")) return;

      try {
        const proxy = ssrProxyModule(code, id);

        return proxy === null ? undefined : { code: proxy, map: null };
      } catch (error) {
        if (error instanceof UseSsrError) this.error(error.message);

        throw error;
      }
    },
  };
}

/**
 * react-dom/server, imported where server components render, becomes a
 * module that throws the fix instead of React's refusal - naming the app
 * file that imported it (through @react-email/render, say) and the
 * directive that moves it. The build says the same once, as a warning.
 */
const RENDERER_STUB = "\0rsc-kit:react-dom-server?from=";

function serverRendererInRsc(): Plugin {
  const warned = new Set<string>();

  const appImporter = (
    ctx: {
      environment: { mode: string; moduleGraph?: unknown };
      getModuleInfo(id: string): { importers: readonly string[] } | null;
    },
    importer: string | null,
  ): string | null => {
    let current = importer;

    for (let hop = 0; current && hop < 12; hop++) {
      if (!current.includes("/node_modules/"))
        return relative(process.cwd(), current.split("?")[0]);

      const next: string | undefined =
        ctx.environment.mode === "build"
          ? ctx.getModuleInfo(current)?.importers[0]
          : ((
              ctx.environment.moduleGraph as
                | {
                    getModuleById(
                      id: string,
                    ): { importers: Set<{ id: string | null }> } | undefined;
                  }
                | undefined
            )
              ?.getModuleById(current)
              ?.importers.values()
              .next().value?.id ?? undefined);

      if (!next) break;

      current = next;
    }

    return importer ? relative(process.cwd(), importer.split("?")[0]) : null;
  };

  return {
    name: "rsc-kit:server-renderer",
    applyToEnvironment: (environment) => environment.name === "rsc",
    resolveId(source, importer) {
      if (!SERVER_RENDERER.test(source)) return;

      return RENDERER_STUB + encodeURIComponent(importer ?? "");
    },
    load(id) {
      if (!id.startsWith(RENDERER_STUB)) return;

      const importer =
        decodeURIComponent(id.slice(RENDERER_STUB.length)) || null;
      const message = serverRendererMessage(
        appImporter(this as never, importer),
      );

      if (this.environment.mode === "build" && !warned.has(message)) {
        warned.add(message);
        this.warn(message);
      }

      return `throw new Error(${JSON.stringify(message)});\n`;
    },
  };
}

/**
 * The project's typecheck, as part of the build.
 *
 * Runs once, in the first environment to start, after the route types have
 * been written by the config hook - so a link to a route that does not exist
 * is an error here and not a 404 found after deploying. Skipped where the
 * project is not doing this checking at all: no tsconfig.json, or no
 * typescript to run. Its own output is the message, because that is what
 * the developer would have read from `tsc`.
 */
export type TypecheckOutcome =
  | { ran: false; because: "no tsconfig" | "no typescript" }
  | { ran: true; ok: true; seconds: number }
  | { ran: true; ok: false; output: string };

/**
 * `tsc --noEmit` on the project's own tsconfig, the way `check` runs it.
 *
 * Through package.json rather than a subpath: TypeScript's exports map does
 * not expose bin/tsc, and the bin field is where the name lives. Its output
 * is the message, because that is what the developer would have read.
 */
export function typecheckProject(root: string): TypecheckOutcome {
  const tsconfig = join(root, "tsconfig.json");

  if (!existsSync(tsconfig)) return { ran: false, because: "no tsconfig" };

  let tsc: string;

  try {
    const fromApp = createRequire(join(root, "package.json"));
    const manifest = fromApp.resolve("typescript/package.json");
    const bin = (fromApp(manifest) as { bin?: string | Record<string, string> })
      .bin;
    const relative = typeof bin === "string" ? bin : bin?.tsc;

    if (!relative) return { ran: false, because: "no typescript" };

    tsc = join(dirname(manifest), relative);
  } catch {
    return { ran: false, because: "no typescript" };
  }

  const started = Date.now();
  const script = /\.[cm]?js$/.test(tsc) || !/\.\w+$/.test(tsc);
  const result = spawnSync(
    script ? process.execPath : tsc,
    // Plain lines, not coloured ones: they go into a build error, and the
    // test that reads them is a reader too.
    [...(script ? [tsc] : []), "--noEmit", "--pretty", "false", "-p", tsconfig],
    { cwd: root, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.status === 0)
    return { ran: true, ok: true, seconds: (Date.now() - started) / 1000 };

  return {
    ran: true,
    ok: false,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

/**
 * The project's typecheck, as part of the build.
 *
 * Runs once, in the first environment to start, after the route types have
 * been written by the config hook - so a link to a route that does not exist
 * is an error here and not a 404 found after deploying. Skipped where the
 * project is not doing this checking at all: no tsconfig.json, or no
 * typescript to run.
 */
function typecheckPlugin(): Plugin {
  let ran = false;

  return {
    name: "rsc-kit:typecheck",
    apply: "build",
    buildStart() {
      if (ran || !typecheck || isWatch) return;

      ran = true;

      const outcome = typecheckProject(projectRoot);

      if (!outcome.ran) return;

      if (outcome.ok) {
        log(`typecheck: ok (${outcome.seconds.toFixed(1)}s)`);

        return;
      }

      throw new Error(
        "[rsc-kit] The typecheck failed, so the build stops here.\n\n" +
          outcome.output +
          "\n\nrscKit({ typecheck: false }) builds without it.",
      );
    },
  };
}

/**
 * Which server files import a client library, read off the rsc environment's
 * module graph once it is built. plugin-rsc classifies the client packages
 * (every package with react among its peers) and excludes them from the
 * server optimizers; that list is the one used here, minus this package -
 * a server component importing Link is the norm - and plugin-rsc's own.
 */
function clientImportsAudit(): Plugin {
  return {
    name: "rsc-kit:client-imports",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "rsc",
    buildEnd() {
      const excluded =
        (resolvedConfig?.environments?.rsc?.optimizeDeps?.exclude as
          string[] | undefined) ?? [];
      const clientPackages = excluded.filter(
        (name) => !name.startsWith("@vitejs/plugin-rsc"),
      );

      if (clientPackages.length === 0) return;

      clientLibraryImports = serverImportsOfClientPackages(
        {
          moduleIds: () => this.getModuleIds(),
          importedIds: (id) => this.getModuleInfo(id)?.importedIds ?? [],
          importers: (id) => this.getModuleInfo(id)?.importers ?? [],
        },
        {
          sourceDir,
          clientPackages,
          ignore: [PACKAGE_NAME, "server-only", "client-only"],
        },
      );
    },
  };
}

export function rscKit(options: RscKitOptions = {}): PluginOption[] {
  resolvePaths(options);

  const routesPlugin: Plugin = {
    name: "rsc-kit",

    config(_config, env) {
      if (!existsSync(appDir)) {
        throw new Error(
          `[rsc-kit] No app directory at ${appDir} — nothing to build.`,
        );
      }

      components.clear();
      discover(appDir);

      // Silent when it worked. The names were printed on every dev start and
      // every build — thirty of them for a middling app, above the output that
      // actually says something, and the build's classification table lists
      // every route anyway.
      //
      // Nothing found is the case worth a word, because the app still builds:
      // a server with no routes answers 404 to everything, which reads as a
      // routing bug rather than as an empty directory. Fatal for a build,
      // said out loud for a dev server — where deleting the last page while
      // editing is a state to pass through, not to be thrown out of.
      if (components.size === 0) {
        const message =
          `No routes under ${appDir}. A directory with a page.tsx in it is a route; ` +
          "without one there is nothing to serve.";

        if (env.command === "build") throw new Error(`[rsc-kit] ${message}`);

        log(message);
      }

      const notClient = validateErrorBoundaries();

      if (notClient.length) {
        throw new Error(
          "[rsc-kit] An error.tsx must be a client component.\n\n" +
            notClient.join("\n") +
            "\n\nAdd 'use client' at the top. It is rendered inside an error boundary and is\n" +
            "handed a reset() callback to call, neither of which a server component can do.",
        );
      }

      const loadingErrors = validateLoadingBoundaries();

      if (loadingErrors.length) {
        throw new Error(
          "[rsc-kit] A page that blocks before it can paint needs a loading.tsx boundary.\n\n" +
            loadingErrors.join("\n") +
            "\n\nAdd loading.tsx in the page directory (or a parent), or move the slow work\n" +
            "into a child component wrapped in its own <Suspense> so the page can paint.",
        );
      }

      // Before the entries, because the app's own source imports these and the
      // module graph is walked as soon as this hook returns.
      const manifest = routeManifest();

      writeHostBindings(manifest);

      if (existsSync(genDir)) rmSync(genDir, { recursive: true, force: true });
      mkdirSync(genDir, { recursive: true });

      // Where a url this server does not own is handed on. Resolved exactly as
      // host calls resolve their endpoint, from the app's own .env, so the two
      // cannot end up pointing at different backends. Development only: a
      // build's server.ts decides this for itself.
      const backendEnv = loadEnv(env.mode, projectRoot, "");

      // Only a backend this server could actually call. The shared secret is
      // what makes one a backend rather than a url that happens to be in the
      // environment — APP_URL is not a Laravel-only name, and a JavaScript
      // host that sets it for its own reasons must not find its 404s being
      // posted to it. Host calls gate on exactly the same pair, so the two
      // cannot end up disagreeing about whether a backend is there.
      //
      // Naming devFallback explicitly opts in regardless: someone who wrote
      // the address down means it.
      const backendSecret =
        hostCallOptions?.secret ?? backendEnv.RSC_HOST_CALL_SECRET;
      const detected = backendSecret
        ? (hostCallOptions?.endpoint ??
          backendEnv.RSC_BACKEND ??
          backendEnv.APP_URL ??
          "")
        : "";

      const fallbackOrigin =
        options.devFallback === false ? "" : (options.devFallback ?? detected);

      writeFileSync(
        join(genDir, "entry.rsc.tsx"),
        generateEntryRsc(fallbackOrigin),
      );
      writeFileSync(join(genDir, "entry.ssr.tsx"), generateEntrySsr());
      writeFileSync(join(genDir, "entry.browser.tsx"), generateEntryBrowser());

      // Written beside the entries, for a host to read instead of walking the
      // route tree itself. Laravel scans it a second time today; a JS host
      // would otherwise have to write a third walk of the same directories.
      writeFileSync(
        join(outDir, "routes.json"),
        JSON.stringify(manifest, null, 2),
      );

      return {
        // Off, not merely unused: Vite warns when publicDir sits inside outDir,
        // and assetsDir is normally a directory under the build output. An app
        // that wants static files can set its own publicDir outside it.
        publicDir: false,
        /**
         * The mode this was built in, baked into the server bundles.
         *
         * Vite substitutes `process.env.NODE_ENV` for a client build and
         * leaves it alone for the server ones, because server code runs where
         * `process.env` is real. Reasonable in general, and wrong here: React
         * picks its build from that expression when its module is first
         * evaluated, so leaving it to the runtime makes every server carry a
         * NODE_ENV it must not get wrong — and a production bundle started
         * without one renders every page perfectly and hydrates none of them.
         *
         * The build already knows which mode it is. Saying so here means the
         * answer travels with the bundle instead of with whoever starts it.
         */
        define: {
          "process.env.NODE_ENV": JSON.stringify(
            env.mode === "development" ? "development" : "production",
          ),
          __RSC_OFFLINE__: JSON.stringify(offline),
        },
        /*
         * This package's client modules are served as source, never
         * pre-bundled.
         *
         * Vite treats an installed package as a dependency and optimizes it,
         * which binds its JSX imports to one particular optimized
         * react/jsx-runtime chunk. The moment Vite discovers another dependency
         * and re-optimizes, that chunk's hash changes and the binding breaks:
         *
         *   SyntaxError: The requested module '.../react_jsx-runtime.js?v=...'
         *   does not provide an export named 't'
         *
         * Which reads as a React or a bundler bug. What it does is take down
         * every page importing Link or Form — the shell renders, hydration
         * throws, React unmounts the document, and the page goes blank with
         * that message the only clue.
         *
         * Excluded rather than pinned, because the package already ships ESM
         * that needs no conversion. The app's own excludes are kept.
         */
        optimizeDeps: {
          exclude: [PACKAGE_NAME, ...(_config.optimizeDeps?.exclude ?? [])],
          // Every "use client" file, so the browser's dependencies are all
          // found at startup. The client entry reaches only the engine and
          // React; the app's client components arrive through payloads, page
          // by page, and a dependency first seen on the third page visited
          // re-optimised every pre-bundle under a running page - two Reacts,
          // a blank document, then Vite's own reload. See clientEntries.
          // Naming entries replaces the input, so the browser entry is named
          // too, or the engine and React would be the ones left out.
          entries: [
            ...(Array.isArray(_config.optimizeDeps?.entries)
              ? _config.optimizeDeps.entries
              : _config.optimizeDeps?.entries
                ? [_config.optimizeDeps.entries]
                : []),
            // Entries are globs: a route group's parentheses, or a bracket
            // in a dynamic segment, would otherwise read as pattern syntax
            // and match nothing - and the scanner would crawl nothing, quietly.
            ...[
              join(genDir, "entry.browser.tsx"),
              ...engineClientEntries(),
              ...clientEntries(sourceDir),
            ].map((file) => file.replace(/[()[\]{}*?!+@]/g, "\\$&")),
          ],
          rolldownOptions: {
            ...(_config.optimizeDeps?.rolldownOptions ?? {}),
            plugins: [
              clientScanPlugin(),
              ...arrayOf(_config.optimizeDeps?.rolldownOptions?.plugins),
            ],
          },
        },
        // Public URL for browser-facing client assets, and a BUILD concern
        // only: it says where the built files will be served from.
        //
        // Applying it in dev makes it Vite's public base, and then the dev
        // server answers pages only under that prefix — every route 404s with
        // "The server is configured with a public base URL", which reads as a
        // routing bug rather than as this line. In dev the pages are the root;
        // the assets come from the same origin either way.
        base: "/",
        // Where the generated entries live, so Vite resolves them as its own
        // source. A build concern only.
        //
        // Not during preview. `vite preview` serves what was built, and Nitro's
        // preview reads its build info from `<vite root>/node_modules/.nitro` —
        // so pointing the root at this directory sent it looking somewhere no
        // build ever writes, and every preview failed with "Cannot load nitro
        // build info. Make sure to build first." after a build that had just
        // succeeded.
        ...(env.isPreview ? {} : { root: outDir }),
        // Force single instances of React/RSC runtime — critical when the
        // package is symlinked (local dev / monorepo), else "use client"
        // components SSR against a second React copy and hooks throw.
        //
        // react-server-dom-webpack is deliberately absent: @vitejs/plugin-rsc
        // vendors its own copy, nothing here imports the specifier, and the
        // built bundles reference it zero times — deduping it was a no-op left
        // over from the hand-rolled engine.
        resolve: {
          dedupe: ["react", "react-dom", "@vitejs/plugin-rsc"],
          // `import Link from '<packageAlias>/Link'` resolves to the client
          // runtime shipped here, for hosts that vendor this package outside
          // node_modules. Installed from npm the name resolves on its own.
          alias: aliasEntries(),
        },
        build: { emptyOutDir: true },
        environments: {
          // Server bundles — stay under the (non-public) out dir. `bun` and
          // `bun:*` are the runtime's own modules, like `node:*`: nothing to
          // bundle, and a build under Node has nothing to resolve them to.
          // Left as imports for the runtime that has them.
          rsc: {
            build: {
              rollupOptions: {
                input: { index: join(genDir, "entry.rsc.tsx") },
                external: RUNTIME_BUILTINS,
              },
            },
          },
          ssr: {
            build: {
              rollupOptions: {
                input: { index: join(genDir, "entry.ssr.tsx") },
                external: RUNTIME_BUILTINS,
              },
            },
          },
          // Client bundle — emitted into public/ for the web server to serve.
          client: {
            build: {
              outDir: publicAssetsDir,
              emptyOutDir: true,
              rollupOptions: {
                input: { index: join(genDir, "entry.browser.tsx") },
                output: { chunkFileNames: clientChunkFileName },
              },
            },
          },
        },
      };
    },

    /**
     * Restart when the route tree changes shape.
     *
     * The entries and the route table are generated in `config()`, which runs
     * once. An edit to a page is picked up because Vite re-evaluates the
     * module, but a page that did not exist when the server started is not in
     * the table — the request 404s, and the file is right there on disk, which
     * is a confusing thing to be told.
     *
     * Only add and unlink: a change to an existing file needs no new table,
     * and restarting on every keystroke would throw away the module graph for
     * nothing.
     */
    configureServer(server) {
      // The icons and share images live in app/, which nothing serves; the
      // build copies them beside the client output. There is no output while
      // developing, so the same hrefs the head tags carry are answered from
      // app/ here - and the web manifest with them - or the tab has no icon
      // and the console a 404 for a file that is right there.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];

        // A worker registered by a production run on this origin - `bun run
        // start` on the port the dev server uses next - outlives that run and
        // answers the dev server's documents from its cache: a stored page is
        // cache-first, so a refresh brings back yesterday's document with
        // yesterday's module hashes, and a 504 for each. The browser fetches
        // /sw.js again on every navigation to look for an update; in
        // development that fetch gets a worker whose only job is to remove
        // itself, its caches, and reload the pages it controlled.
        if (url === "/sw.js") {
          res.setHeader("Content-Type", "text/javascript");
          res.setHeader("Cache-Control", "no-store");
          res.end(DEV_WORKER);

          return;
        }

        if (webManifestOptions && url === MANIFEST_PATH) {
          res.setHeader("Content-Type", "application/manifest+json");
          res.end(webManifest(webManifestOptions));

          return;
        }

        const asset = allAppAssets(foundAssets).find((a) => a.href === url);
        const file = asset ? join(sourceDir, "app", asset.file) : null;

        if (!asset || !file || !existsSync(file)) return next();

        res.setHeader("Content-Type", typeOf(asset.file));
        createReadStream(file).pipe(res);
      });

      // rpc() has to reach the backend while the dev server is serving.
      //
      // A built deployment installs this itself: the server running
      // createRscHandler passes `hostCalls`. Nothing does that here, and with
      // no host installed every rpc() is refused — so a page whose data comes
      // from the backend renders its shell and then blanks, which reads as a
      // hydration bug rather than a missing wire.
      server.httpServer?.once("listening", async () => {
        const env = server.environments?.rsc as
          | {
              runner?: { import(id: string): Promise<Record<string, unknown>> };
            }
          | undefined;

        if (!env?.runner) return;

        // The app's own .env, unprefixed. A Laravel app already has both of
        // these, which is what makes this need no configuring: APP_URL is the
        // backend and RSC_HOST_CALL_SECRET is the secret it checks.
        const fromEnv = loadEnv(server.config.mode, projectRoot, "");
        const secret = hostCallOptions?.secret ?? fromEnv.RSC_HOST_CALL_SECRET;
        const origin =
          hostCallOptions?.endpoint ?? fromEnv.RSC_BACKEND ?? fromEnv.APP_URL;

        if (!secret || !origin) return;

        const path =
          hostCallOptions?.path ??
          fromEnv.RSC_HOST_CALL_PATH ??
          "/__rsc/host-call";
        const endpoint = origin.replace(/\/$/, "") + path;

        try {
          const entry = await env.runner.import(join(genDir, "entry.rsc.tsx"));
          const install = entry.installHostFn as
            ((fn: unknown) => void) | undefined;

          install?.(httpHostCalls({ endpoint, secret }));
        } catch (error) {
          // Reported rather than thrown: the dev server is still useful for
          // every page that needs no data, and a failure here would otherwise
          // look like the server refusing to start.
          server.config.logger.warn(
            `[rsc-kit] could not wire host calls to ${endpoint}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      });

      // Written once the server is listening, because only then is the port
      // known. Removed on shutdown so a backend can tell a dev server that is
      // gone from one that is merely slow to answer.
      if (hotFile) {
        const remove = () => {
          try {
            if (existsSync(hotFile)) rmSync(hotFile);
          } catch {}
        };

        server.httpServer?.once("listening", () => {
          // The url Vite resolved, not one built from the port. A dev server
          // whose port is already taken on IPv4 binds IPv6 only and keeps the
          // number — so http://127.0.0.1:<port> is a reachable-looking address
          // that nothing answers, and the backend reports the renderer as down
          // while it is plainly running.
          const resolved = server.resolvedUrls?.local?.[0];
          const address = server.httpServer?.address();

          const url =
            resolved ??
            (typeof address === "object" && address
              ? `http://${address.family === "IPv6" ? `[${address.address}]` : address.address}:${address.port}`
              : null);

          if (!url) return;

          mkdirSync(dirname(hotFile), { recursive: true });
          writeFileSync(hotFile, url.replace(/\/$/, ""));
        });

        for (const signal of ["SIGINT", "SIGTERM", "exit"] as const) {
          process.once(signal, remove);
        }

        server.httpServer?.once("close", remove);
      }

      const shapes = new Set(ROUTE_FILES.map((name) => name));

      const affectsRouting = (file: string): boolean => {
        if (!file.startsWith(sourceDir)) return false;

        const base = file.split("/").pop() ?? "";
        const stem = base.replace(/\.(tsx|jsx|ts|js)$/, "");

        // The host's route-config file, whatever it named it. Hardcoding one
        // here would put a backend's convention back into a plugin that is
        // published without any — generic-host.test.ts fails if it reappears.
        return (
          (base !== stem && shapes.has(stem)) ||
          SECTION_FILE.test(base) ||
          (routeConfig !== null && base === routeConfig.file)
        );
      };

      const restart = (file: string) => {
        if (!affectsRouting(file)) return;

        server.config.logger.info(
          `[rsc-kit] route tree changed (${file.slice(sourceDir.length + 1)}) — restarting`,
        );
        void server.restart();
      };

      // Watched explicitly: the Vite root is the *out* directory, so the app's
      // source tree is outside it and nothing would report a file appearing.
      server.watcher.add(sourceDir);

      server.watcher.on("add", restart);
      server.watcher.on("unlink", restart);
    },

    /**
     * Freeze what can be frozen, once every bundle exists.
     *
     * `buildApp` runs after all three environments are built, which is the
     * first moment the rsc bundle can be imported — prerendering is the app
     * rendering itself, so it needs the thing the build just produced. This
     * plugin is ordered after @vitejs/plugin-rsc's, so its own buildApp has
     * already run and the bundles are on disk.
     *
     * Automatic because the alternative is a second command to remember, and
     * forgetting it costs the whole difference silently: every page still
     * works, each one just renders again for every visitor.
     *
     * Skipped in watch mode. A rebuild on every keystroke that also re-renders
     * every route is not a feedback loop anyone wants.
     */
    async buildApp(builder) {
      if (isWatch) return;

      // Say what the build did, even when it stored nothing.
      //
      // Turning prerendering off used to print no classification at all — no
      // marks, no legend, no counts — so a build that stored nothing looked
      // exactly like a build that had not got to that step. Every route renders
      // per visitor now, which is a thing worth being told rather than left to
      // infer from an absence.
      if (!prerenderAfterBuild) {
        reportAllDynamic();

        return;
      }

      // Asked of the build rather than assumed from `outDir`. The two layouts
      // differ — <outDir>/dist/rsc on its own, node_modules/.nitro/… under
      // Nitro — and hard-coding the first is what silently skipped the second.
      // Both environments emit `index.js`, so this is one path, not a branch.
      const rscOut =
        builder?.environments?.rsc?.config?.build?.outDir ??
        join(outDir, "dist/rsc");
      const bundle = resolveRscBundle(rscOut);

      // Where the frozen pages go, which is not the same question.
      //
      // On its own the plugin owns the output and server.ts reads <outDir>/static
      // from the repository. Under Nitro the deployment is `.output/` and
      // nothing outside it is copied to the server — so pages written anywhere
      // else exist on the build machine and nowhere after that. They go beside
      // the server bundle instead, and buildApp runs before Nitro assembles, so
      // they are in place by the time it does.
      const clientOut = builder?.environments?.client?.config?.build?.outDir;
      const staticDir = clientOut
        ? join(dirname(clientOut), "server", NITRO_STATIC_DIR)
        : join(outDir, NITRO_STATIC_DIR);

      const { frozen, results } = await prerenderAfterBundles(
        bundle,
        staticDir,
        clientOut ?? publicAssetsDir,
        builder ? knownActionsOf(builder.config, projectRoot) : [],
      );

      // The same pages once more, as a module. A Worker has no filesystem, and
      // until this existed every Cloudflare deploy rendered its "static" pages
      // live, silently - the reader found no directory and fell through. The
      // module is uploaded as a sibling of the bundle and imported at runtime
      // when the directory is not there. Only under Nitro, whose presets are
      // the ones without a disk; on its own the plugin serves from outDir.
      if (clientOut && existsSync(staticDir)) {
        const { inlineModuleName, inlineModuleSource } =
          await import("./files.js");

        writeFileSync(
          join(dirname(staticDir), inlineModuleName(NITRO_STATIC_DIR)),
          await inlineModuleSource(staticDir),
        );
      }

      // Manifest first. The service worker precaches whatever it finds in this
      // directory, so writing it afterwards leaves it out of the list — and an
      // installed app whose manifest is the one file that needs the network is
      // the wrong way round.
      copyAppAssets(clientOut ?? publicAssetsDir);
      if (webManifestOptions)
        writeWebManifest(clientOut ?? publicAssetsDir, webManifestOptions);
      if (offline) {
        writeServiceWorker(
          clientOut ?? publicAssetsDir,
          frozen,
          offlineFallback(frozen, results),
        );
      }
    },

    configResolved(config: ResolvedConfig) {
      isWatch = config.build?.watch != null;
      resolvedConfig = config;

      // Keep Nitro's hot-update handler out of the rsc environment.
      //
      // For every environment that is not the browser's, Nitro treats a
      // changed module the browser does not also have as "the server changed,
      // reload the page": it sends full-reload and returns an EMPTY module list.
      // A returned list replaces the modules every later hook sees — so
      // plugin-rsc's handler, which is the one that knows a server component
      // can be refetched in place, gets zero modules, returns early, and never
      // sends rsc:update.
      //
      // That was a crude reload on a plain app and no reload at all on one
      // with Tailwind, whose own hook runs earlier still and rewrites the
      // change as a CSS update — so Nitro saw nothing server-only either, and
      // an edit to a page did nothing in the browser.
      //
      // The rsc environment's reload story is plugin-rsc's, not Nitro's.
      // Nitro's hook is left alone for every other environment.
      type HotHook = (
        this: { environment?: { name?: string } },
        ctx: unknown,
      ) => unknown;
      const nitroMain = config.plugins.find((p) => p.name === "nitro:main") as
        { hotUpdate?: HotHook } | undefined;

      if (nitroMain?.hotUpdate) {
        const original = nitroMain.hotUpdate;

        nitroMain.hotUpdate = function (this, ctx) {
          if (this.environment?.name === "rsc") return;

          return original.call(this, ctx);
        } as HotHook;
      }
      // rsc() splits the module graph into client and server; a JSX transform
      // placed ahead of it sees the wrong graph and fails in ways that are hard
      // to trace back here. Cheaper to refuse than to let it through.
      const names = config.plugins.map((p) => p.name);
      const rscAt = names.findIndex((n) => n === "rsc" || n.startsWith("rsc:"));
      const jsxAt = names.findIndex((n) => JSX_PLUGIN_PATTERN.test(n));

      if (rscAt !== -1 && jsxAt !== -1 && jsxAt < rscAt) {
        throw new Error(
          `[rsc-kit] Plugin "${names[jsxAt]}" is resolved ahead of rsc(), so it would ` +
            "transform JSX before the client/server split.\n" +
            "Put rscKit() first in your plugins array. If it already is, that plugin " +
            "sets enforce: 'pre' and needs to be moved after rsc() explicitly.",
        );
      }
    },
  };

  // rsc() ships as several plugins, and it has to lead. A promise is a legal
  // member of a Vite plugins array and is flattened in place, so this keeps
  // rscKit() one entry in the app's config while still resolving the
  // plugin at call time — see appPluginRsc for why that matters.
  // With Nitro, the server handler is Nitro's — it takes the rsc entry's
  // default export and builds the server around it. Leaving plugin-rsc's own
  // handler in place means two things claiming the same role.
  return [
    appPluginRsc({
      serverHandler: false,
      // One chunk per client component, rather than one for the whole app.
      //
      // plugin-rsc already loads a client reference with `await import()`, so
      // the browser only fetches what a page actually renders — but its default
      // groups every reference by the SERVER chunk that proxies it, and this
      // package builds the server as a single chunk. So every client component
      // in an app landed in one group, and a page with a button pulled in the
      // editor, the chart and the map that live on other routes.
      //
      // Grouping by the component's own module restores the split the dynamic
      // import was there to make use of.
      clientChunks: (meta) => meta.normalizedId,
      ...actionEncryptionKey(),
    }),
    useSsrModules(),
    serverRendererInRsc(),
    extendableClientReferences(),
    typecheckPlugin(),
    clientImportsAudit(),
    routesPlugin,
  ];
}

/**
 * @vitejs/plugin-rsc, resolved from the app rather than from here.
 *
 * `isRunnableDevEnvironment` is an instanceof check that plugin-rsc runs
 * against its own copy of Vite. Two copies — this package's and the app's —
 * make a perfectly runnable environment report false, and the message names
 * the environment rather than the duplication.
 *
 * That is not a hypothetical layout. It is what installing this package from a
 * directory produces, because the checkout carries its own devDependencies:
 * the app runs its Vite, this file imports that Vite's plugin, and the two
 * never recognise each other. A build never reaches the check, so everything
 * works right up until dev mode.
 *
 * Resolving from the project root gets the app's copy, whose own `vite` import
 * then resolves to the app's Vite as well — one pair, and the check passes.
 */
/**
 * Where the key that encrypts bound action arguments comes from.
 *
 * A server action can close over server-side values, and React sends those to
 * the browser encrypted so the page cannot read them. The process that decrypts
 * them on the way back has to hold the same key.
 *
 * By default plugin-rsc generates one per build and bakes it in. Every instance
 * of one build therefore agrees, and the only exposure is a deploy: a browser
 * holding a page from the old build calls an action on the new one, and the
 * key has changed underneath it. The call fails with nothing useful in it.
 *
 * Setting RSC_ACTION_ENCRYPTION_KEY makes the key outlive the build and closes
 * that window. It is read at RUNTIME, not baked in, so the same artifact can be
 * deployed anywhere — but it must then be set everywhere the app runs, and set
 * to the same value. Half-configured is worse than unconfigured: instances
 * would disagree, and the failure looks like an intermittently broken action.
 *
 * Unset, the build-time key is used and nothing changes. That is the default
 * because it is the one that cannot be got half right.
 */
function actionEncryptionKey(): { defineEncryptionKey?: string } {
  if (!process.env.RSC_ACTION_ENCRYPTION_KEY) return {};

  // An expression, not a value: plugin-rsc substitutes this source text where
  // the key is read, so what ships is the lookup rather than the secret. A
  // literal here would put the key in the bundle, which is the thing being
  // avoided.
  return { defineEncryptionKey: "process.env.RSC_ACTION_ENCRYPTION_KEY" };
}

async function appPluginRsc(
  options: Parameters<typeof rsc>[0] = {},
): Promise<PluginOption[]> {
  try {
    // Resolved against a file *in* the root, since a directory specifier
    // resolves relative to its parent.
    const fromApp = createRequire(join(projectRoot, "package.json"));
    const entry = fromApp.resolve("@vitejs/plugin-rsc");
    const mod = (await import(pathToFileURL(entry).href)) as {
      default: typeof rsc;
    };

    return (mod.default ?? rsc)(options);
  } catch {
    // The app does not have its own; one copy, and the bundled import is it.
    return rsc(options);
  }
}
