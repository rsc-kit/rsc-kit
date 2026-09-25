// An OpenAPI document from the route tree, and a page that reads it.
//
// Every route.ts already says what an operation needs: the methods it
// exports, and the params, searchParams and body schemas beside them. A
// Standard Schema describes itself as JSON Schema (Zod 4 and ArkType do;
// Valibot needs its converter and contributes nothing here), so the document
// is derived rather than written - the way Elysia derives its from TypeBox.
// Nothing is annotated twice.
//
// The document is built from the modules the generated entry imported, and
// stored by the build like any other api route that reads nothing per
// request. The page that reads it is Scalar's own package, mounted as a
// route: `export const GET = ApiReference({ url: '/openapi.json' })`.

type JsonSchema = Record<string, unknown> & {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

type WithJsonSchema = {
  "~standard"?: {
    jsonSchema?: {
      input?: (options: { target: string; libraryOptions?: Record<string, unknown> }) => unknown;
    };
  };
};

/** What the generated entry hands over for each route.ts. */
export interface OpenApiRoute {
  /** The route's pattern in this package's spelling: `/api/orders/[id]`. */
  pattern: string;
  methods: string[];
  /** The middleware.ts files above it: a guarded route gets a security requirement. */
  guarded: boolean;
  /** The route module: its params, searchParams, body and openapi exports, if any. */
  module: Record<string, unknown>;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** The extras a route declared for one method: the shared ones, then that method's. */
function extrasFor(module: Record<string, unknown>, method: string): OpenApiOperationExtras {
  const declared = module.openapi;

  if (declared === null || typeof declared !== "object") return {};

  const record = declared as Record<string, unknown>;
  const shared: Record<string, unknown> = {};
  const own = (record[method] ?? {}) as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (!METHODS.has(key)) shared[key] = value;
  }

  return { ...shared, ...own };
}

export interface OpenApiInfo {
  title?: string;
  version?: string;
  description?: string;
}

/**
 * What the document says that no route can: where the API is served, and
 * how a caller authenticates. Spread onto the document as written, so
 * anything OpenAPI allows at the top level is allowed here.
 */
export interface OpenApiDocumentOptions {
  /**
   * Which routes the document describes. `'all'` (the default) is every
   * route.ts that did not opt out; `'declared'` is only the ones that
   * export `openapi`, for an app whose routes are mostly webhooks and
   * callbacks with a handful of endpoints meant for a caller to read about.
   */
  include?: "all" | "declared";
  info?: OpenApiInfo;
  servers?: { url: string; description?: string }[];
  security?: Record<string, string[]>[];
  components?: Record<string, unknown>;
  tags?: { name: string; description?: string }[];
}

/**
 * What a route.ts may say about itself, beside its handler:
 *
 *     export const openapi = {
 *       summary: 'Chat completions',
 *       tags: ['Chat'],
 *       responses: { 200: { description: 'The completion', content: { … } } },
 *     }
 *
 * Merged onto every operation the file exports, or per method when keyed
 * by one: `{ POST: { summary: … } }`. Anything OpenAPI allows on an operation.
 * `false` leaves the route out of the document altogether; `{ DELETE: false }`
 * leaves one method out. HEAD and OPTIONS are never documented: the engine
 * answers them for every route.
 */
export type OpenApiOperationExtras = Record<string, unknown>;

/** A Standard Schema's JSON Schema, or null when it cannot describe itself. */
function jsonSchemaOf(schema: unknown): JsonSchema | null {
  if (schema === null || typeof schema !== "object") return null;

  try {
    const produce = (schema as WithJsonSchema)["~standard"]?.jsonSchema?.input;

    if (typeof produce !== "function") return null;

    // A leaf JSON Schema cannot say - a Date, a custom check - documents as
    // `{}` rather than costing the route its whole body schema.
    const json = produce({ target: "draft-2020-12", libraryOptions: { unrepresentable: "any" } }) as JsonSchema;

    // The dialect marker belongs on the document, not on every schema in it.
    delete json.$schema;

    return json;
  } catch {
    return null;
  }
}

/** `/api/orders/[id]/route` → `/api/orders/{id}`, and the names it binds. */
export function openApiPath(pattern: string): { path: string; params: string[] } {
  const params: string[] = [];
  const path = pattern.replace(/\[(?:\.\.\.)?(\w+)\]/g, (_, name: string) => {
    params.push(name);

    return `{${name}}`;
  });

  return { path, params };
}

const HAS_BODY = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The document.
 *
 * Path parameters come from the pattern, typed by the route's `params` schema
 * where it has one and as strings otherwise; query parameters from the
 * `searchParams` schema's properties, each optional unless the schema
 * requires it; a request body from the `body` schema, as JSON. A guarded
 * route names the session as its security requirement, which is what a
 * middleware.ts above it checks.
 */
export function buildOpenApi(routes: OpenApiRoute[], options: OpenApiDocumentOptions = {}): Record<string, unknown> {
  const { info = {}, include = "all", ...rest } = options;
  const paths: Record<string, Record<string, unknown>> = {};
  let anyGuarded = false;

  for (const route of routes) {
    // `export const openapi = false`: a route that is not part of the API -
    // the page that renders this document, a webhook for one caller. With
    // include: 'declared', a route with no `openapi` export is the same.
    if (route.module.openapi === false) continue;
    if (include === "declared" && route.module.openapi === undefined) continue;

    const { path, params } = openApiPath(route.pattern);
    const paramsSchema = jsonSchemaOf(route.module.params);
    const searchSchema = jsonSchemaOf(route.module.searchParams);
    const bodySchema = jsonSchemaOf(route.module.body);

    const pathParameters = params.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: paramsSchema?.properties?.[name] ?? { type: "string" },
    }));

    const queryParameters = Object.entries(searchSchema?.properties ?? {}).map(([name, schema]) => ({
      name,
      in: "query",
      required: searchSchema?.required?.includes(name) ?? false,
      schema,
    }));

    const operations: Record<string, unknown> = {};

    for (const method of route.methods) {
      // HEAD and OPTIONS are answered for every route by the engine, and a
      // file that exports one - a CORS preflight - is not documenting an
      // operation. `openapi: { OPTIONS: false }` drops any other method.
      if (method === "HEAD" || method === "OPTIONS") continue;
      if (((route.module.openapi as Record<string, unknown> | undefined)?.[method]) === false) continue;

      const operation: Record<string, unknown> = {
        operationId: `${method.toLowerCase()}${path
          .replace(/\{(\w+)\}/g, "By$1")
          .split("/")
          .filter(Boolean)
          .map((part) => part[0].toUpperCase() + part.slice(1))
          .join("")}`,
        parameters: [...pathParameters, ...queryParameters],
        responses: { "200": { description: "OK" } },
      };

      if (bodySchema && HAS_BODY.has(method)) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: bodySchema } },
        };
        (operation.responses as Record<string, unknown>)["422"] = {
          description: "The input was refused; validationErrors names each field.",
        };
      }

      if (route.guarded) {
        anyGuarded = true;
        operation.security = [{ session: [] }];
        (operation.responses as Record<string, unknown>)["401"] = { description: "Not signed in." };
        (operation.responses as Record<string, unknown>)["403"] = { description: "Signed in, and still not allowed." };
      }

      // What the route said about itself wins over what was derived, field
      // by field; its responses merge onto the derived ones.
      const extras = extrasFor(route.module, method);
      const responses = { ...(operation.responses as object), ...((extras.responses as object) ?? {}) };

      operations[method.toLowerCase()] = { ...operation, ...extras, responses };
    }

    paths[path] = { ...(paths[path] ?? {}), ...operations };
  }

  const document: Record<string, unknown> = {
    openapi: "3.1.0",
    info: {
      title: info.title ?? "API",
      version: info.version ?? "0.0.0",
      ...(info.description ? { description: info.description } : {}),
    },
    ...rest,
    paths,
  };

  if (anyGuarded) {
    const components = (rest.components ?? {}) as Record<string, unknown>;
    const schemes = (components.securitySchemes ?? {}) as Record<string, unknown>;

    document.components = {
      ...components,
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: "session",
          description: "The visitor's session, checked by the middleware.ts above the route.",
        },
        ...schemes,
      },
    };
  }

  return document;
}

/** The document, as a route answers it: JSON, cacheable, built once. */
export function openApiResponse(routes: OpenApiRoute[], options: OpenApiDocumentOptions = {}): Response {
  return Response.json(buildOpenApi(routes, options), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
