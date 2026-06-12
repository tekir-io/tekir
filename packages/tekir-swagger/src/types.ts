
export interface SwaggerConfig {
  title?: string
  version?: string
  description?: string
  // Base path for both the UI and the JSON spec (default: '/docs')
  path?: string
  servers?: Array<{ url: string; description?: string }>
  /**
   * Protect the swagger UI and JSON spec with HTTP Basic auth. When set,
   * `/docs`, `/docs/`, and `/docs/json` reject any request whose
   * `Authorization` header doesn't match. Leave undefined to expose the
   * docs publicly.
   *
   * @example
   *   swagger(router, {
   *     path: '/docs',
   *     auth: { username: 'admin', password: process.env.DOCS_PASSWORD! },
   *   })
   */
  auth?: SwaggerBasicAuth
  /**
   * Explicitly enable or disable registration of the docs routes. When
   * omitted, the docs are auto-gated: they are NOT registered in production
   * (`NODE_ENV === 'production'`) unless `auth` is configured. This prevents
   * the full route map and schemas from leaking publicly when a developer
   * forgets to gate them. Set `enabled: true` to force-register (e.g. behind
   * your own auth proxy) or `enabled: false` to force-disable.
   */
  enabled?: boolean
  /**
   * Hide internal/admin routes from the generated spec. Each entry is matched
   * against the route's OpenAPI path: a string matches as a prefix, a RegExp
   * is tested against the full path. Routes can also be hidden per-handler
   * with the `@ApiHide()` decorator.
   *
   * @example
   *   swagger(router, { hidePaths: ['/admin', '/internal', /^\/debug/] })
   */
  hidePaths?: Array<string | RegExp>
  /**
   * Override the Swagger UI asset URLs. Use when self-hosting the bundle
   * or pinning to a specific version with subresource integrity (SRI).
   * If `integrity` is provided, the corresponding `<link>`/`<script>`
   * tag emits an `integrity="..." crossorigin="anonymous"` pair so the
   * browser refuses to execute tampered CDN assets.
   *
   * @default Bundles served from jsDelivr at a pinned version, no SRI.
   */
  ui?: {
    cssUrl?: string
    jsUrl?: string
    cssIntegrity?: string
    jsIntegrity?: string
  }
}

export interface SwaggerBasicAuth {
  username: string
  password: string
  /** WWW-Authenticate realm. Default: "docs". */
  realm?: string
}

export interface OpenApiSchema {
  type?: string
  format?: string
  description?: string
  enum?: unknown[]
  items?: OpenApiSchema
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  $ref?: string
  nullable?: boolean
  default?: unknown
  example?: unknown
  // Extension fields (oneOf, allOf, additionalProperties, etc.)
  [key: string]: unknown
}

export interface ApiParamOptions {
  type?: string
  format?: string
  description?: string
  required?: boolean
  example?: unknown
  enum?: readonly unknown[]
}

// Metadata stored per-method by the API decorators
export interface EndpointMeta {
  tags?: string[]
  summary?: string
  body?: OpenApiSchema
  responses?: Array<{ status: number; schema: OpenApiSchema }>
  params?: Array<{ name: string; options: ApiParamOptions }>
  bearerAuth?: boolean
  /** When true, the route is omitted from the generated OpenAPI spec. */
  hidden?: boolean
}

// All metadata is keyed by a stable symbol attached to the handler function.

export const META_KEY = Symbol.for('__tekir_swagger_meta')

/**
 * Get or initialize swagger metadata on a handler function.
 * @param {any} fn - The handler function
 * @returns {EndpointMeta} The metadata object attached to the function
 */
export function getMeta(fn: any): EndpointMeta {
  if (!fn[META_KEY]) fn[META_KEY] = {}
  return fn[META_KEY]
}

export interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, OpenApiPathItem>
  components: {
    securitySchemes?: Record<string, OpenApiSecurityScheme>
  }
  tags?: Array<{ name: string }>
}

// OpenAPI path item — method keys map to operation objects
export type OpenApiPathItem = Record<string, OpenApiOperation>

// OpenAPI operation object
export interface OpenApiOperation {
  tags: string[]
  summary: string
  operationId: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses: Record<string, OpenApiResponseObject>
  security?: Array<Record<string, string[]>>
}

export interface OpenApiParameter {
  name: string
  in: string
  required: boolean
  description?: string
  schema: { type: string; format?: string; example?: unknown }
}

export interface OpenApiRequestBody {
  required: boolean
  content: Record<string, { schema: OpenApiSchema }>
}

export interface OpenApiResponseObject {
  description: string
  content?: Record<string, { schema: OpenApiSchema }>
}

// Security scheme (HTTP bearer)
export interface OpenApiSecurityScheme {
  type: string
  scheme: string
  bearerFormat?: string
}

// Router interface — supports both getTrie() and direct .root access.
// `get` is only invoked by `swagger()` when wiring the live spec route;
// spec-builder fixtures that only run schema generation can omit it.
export interface RouterLike {
  getTrie?: () => { root?: any }
  root?: any
  get?(path: string, handler: (...args: any[]) => any): any
}

// Handler function type — may carry swagger metadata via META_KEY
export type RouteHandler = ((...args: unknown[]) => unknown) & Partial<Record<symbol, EndpointMeta>> & { __original?: RouteHandler }

export interface CollectedRoute {
  method: string
  pattern: string
  paramNames: string[]
  name?: string
  handler: RouteHandler
  meta?: Record<string, unknown>
}

// Internal node shape from the router trie (opaque, accessed by duck-typing)
export type TrieNode = Record<string, unknown>

// Shape of a registered route entry stored in node.handlers
export interface RegisteredRouteEntry {
  pattern: string
  paramNames?: string[]
  name?: string
  handler: RouteHandler
}
