import type {
  SwaggerConfig,
  OpenApiSchema,
  OpenApiSpec,
  OpenApiPathItem,
  OpenApiOperation,
  OpenApiResponseObject,
  RouterLike,
  CollectedRoute,
  TrieNode,
  RegisteredRouteEntry,
  ApiParamOptions,
  EndpointMeta,
} from './types'
import { META_KEY } from './types'


/**
 * Recursively collect all registered routes from a router trie node.
 * @param {TrieNode} node - The trie node to traverse
 * @returns {CollectedRoute[]} Array of collected route definitions
 *
 * @example
 * ```ts
 * const trie = router.getTrie()
 * const routes = collectRoutes(trie.root)
 * ```
 */
export function collectRoutes(node: TrieNode): CollectedRoute[] {
  const routes: CollectedRoute[] = []

  // node.handlers is a Map<string, RegisteredRoute>
  if (node.handlers && node.handlers instanceof Map) {
    for (const [m, registeredRoute] of (node.handlers as Map<string, RegisteredRouteEntry>).entries()) {
      routes.push({
        method: m,
        pattern: registeredRoute.pattern,
        paramNames: registeredRoute.paramNames || [],
        name: registeredRoute.name,
        handler: registeredRoute.handler,
        meta: (registeredRoute as any).meta,
      })
    }
  }

  // Recurse into static children
  if (node.children && node.children instanceof Map) {
    for (const child of (node.children as Map<string, TrieNode>).values()) {
      routes.push(...collectRoutes(child))
    }
  }

  // Recurse into param child
  if (node.paramChild) {
    routes.push(...collectRoutes((node.paramChild as TrieNode).node as TrieNode))
  }

  // Recurse into wildcard child
  if (node.wildcardChild) {
    routes.push(...collectRoutes((node.wildcardChild as TrieNode).node as TrieNode))
  }

  return routes
}

// Deduplicate by (method, pattern)
function deduplicateRoutes(routes: CollectedRoute[]): CollectedRoute[] {
  const seen = new Set<string>()
  const result: CollectedRoute[] = []
  for (const r of routes) {
    const key = `${r.method}::${r.pattern}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(r)
    }
  }
  return result
}

// Convert `:id` and `:id?` style params to `{id}` (OpenAPI style)
function toOpenApiPath(pattern: string): string {
  return pattern
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)\?/g, '{$1}')
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}')
    .replace(/\*/g, '{wildcard}')
}

// Derive a tag from the first two path segments, e.g. /api/users/... → 'users'
function deriveTagFromPath(pattern: string): string {
  const parts = pattern.split('/').filter(Boolean)
  // Skip common prefixes like 'api', 'v1', 'v2'
  const skip = new Set(['api', 'v1', 'v2', 'v3'])
  for (const p of parts) {
    if (!skip.has(p) && !p.startsWith(':') && p !== '*') {
      return p.charAt(0).toUpperCase() + p.slice(1)
    }
  }
  return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'Default'
}


/**
 * Get a human-readable description for an HTTP status code.
 * @param {number} status - The HTTP status code
 * @returns {string} The status description (e.g. 'OK', 'Not Found')
 *
 * @example
 * ```ts
 * httpStatusDescription(200) // 'OK'
 * httpStatusDescription(404) // 'Not Found'
 * ```
 */
export function httpStatusDescription(status: number): string {
  const map: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  }
  return map[status] || String(status)
}


/**
 * Build a complete OpenAPI 3.0.3 specification from a router's registered routes.
 * Collects route metadata from decorators and route builder fluent API.
 *
 * @param {RouterLike} router - The router instance (must expose getTrie() or root)
 * @param {SwaggerConfig} [config={}] - Swagger configuration (title, version, description, servers)
 * @returns {OpenApiSpec} The complete OpenAPI specification object
 *
 * @example
 * ```ts
 * const spec = buildOpenApiSpec(router, {
 *   title: 'My API',
 *   version: '2.0.0',
 *   servers: [{ url: 'https://api.example.com' }]
 * })
 * ```
 */
export function buildOpenApiSpec(router: RouterLike | null | undefined, config: SwaggerConfig = {}): OpenApiSpec {
  const title = config.title || 'API Documentation'
  const version = config.version || '1.0.0'
  const description = config.description

  // Retrieve trie root — Router exposes getTrie()
  let allRoutes: CollectedRoute[] = []

  if (router && typeof router.getTrie === 'function') {
    const trie = router.getTrie()
    if (trie && trie.root) {
      allRoutes = deduplicateRoutes(collectRoutes(trie.root))
    }
  } else if (router && router.root) {
    // Direct trie passed
    allRoutes = deduplicateRoutes(collectRoutes(router.root))
  }

  const paths: Record<string, OpenApiPathItem> = {}
  const tagSet = new Set<string>()
  let hasBearerAuth = false

  const hidePaths = config.hidePaths ?? []
  const isHiddenPath = (openApiPath: string): boolean =>
    hidePaths.some(p => typeof p === 'string' ? openApiPath.startsWith(p) : p.test(openApiPath))

  for (const route of allRoutes) {
    if (route.method === 'ANY' || route.method === 'WS') continue

    const openApiPath = toOpenApiPath(route.pattern)

    // Skip routes hidden by config path match.
    if (isHiddenPath(openApiPath)) continue

    const handler = route.handler
    // Try to find the original handler for decorated controllers
    const originalFn = handler?.__original || handler

    // Collect metadata from: decorator symbols + route.meta (RouteBuilder fluent API)
    const routeMeta = (route as any).meta || {}
    const meta: EndpointMeta = {
      ...(originalFn?.[META_KEY] || {}),
      ...(handler?.[META_KEY] || {}),
    }

    // Skip routes hidden via @ApiHide() decorator or route builder meta.
    if (meta.hidden || routeMeta['swagger:hidden']) continue

    if (!paths[openApiPath]) paths[openApiPath] = {}
    // Merge route builder meta (swagger:summary, swagger:body, etc.)
    if (routeMeta['swagger:summary']) meta.summary = routeMeta['swagger:summary'] as string
    if (routeMeta['swagger:body']) meta.body = routeMeta['swagger:body'] as OpenApiSchema
    if (routeMeta['swagger:responses']) meta.responses = routeMeta['swagger:responses'] as EndpointMeta['responses']
    if (routeMeta['swagger:params']) meta.params = routeMeta['swagger:params'] as EndpointMeta['params']
    if (routeMeta['swagger:bearerAuth']) meta.bearerAuth = true
    if (routeMeta['swagger:tags']) meta.tags = routeMeta['swagger:tags'] as string[]

    // Tags: from decorator, route meta, or auto-derived
    const tags: string[] = meta.tags && meta.tags.length > 0
      ? meta.tags
      : [deriveTagFromPath(route.pattern)]

    for (const t of tags) tagSet.add(t)
    if (meta.bearerAuth) hasBearerAuth = true

    // Path parameters — merge from route paramNames + explicit @ApiParam annotations
    const explicitParamMap = new Map<string, ApiParamOptions>(
      (meta.params || []).map(p => [p.name, p.options])
    )

    const pathParams = route.paramNames
      .filter(n => n !== '*')
      .map(name => {
        const opts = explicitParamMap.get(name) || {}
        return {
          name,
          in: 'path',
          required: opts.required !== false,
          description: opts.description,
          schema: {
            type: opts.type || 'string',
            ...(opts.format ? { format: opts.format } : {}),
            ...(opts.example !== undefined ? { example: opts.example } : {}),
          },
        }
      })

    // Extra @ApiParam annotations not already in paramNames (e.g. query params manually declared)
    for (const [name, opts] of explicitParamMap.entries()) {
      if (!route.paramNames.includes(name)) {
        pathParams.push({
          name,
          in: 'query',
          required: opts.required === true,
          description: opts.description,
          schema: {
            type: opts.type || 'string',
            ...(opts.format ? { format: opts.format } : {}),
            ...(opts.example !== undefined ? { example: opts.example } : {}),
          },
        })
      }
    }

    const operation: OpenApiOperation = {
      tags,
      summary: meta.summary || '',
      operationId: route.name || `${route.method.toLowerCase()}_${openApiPath.replace(/[^a-zA-Z0-9]/g, '_')}`,
      responses: {},
    }

    if (pathParams.length > 0) operation.parameters = pathParams

    // Request body
    if (meta.body && ['POST', 'PUT', 'PATCH'].includes(route.method)) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: meta.body,
          },
        },
      }
    }

    // Responses
    const responsesObj: Record<string, OpenApiResponseObject> = {}

    if (meta.responses && meta.responses.length > 0) {
      for (const r of meta.responses) {
        responsesObj[String(r.status)] = {
          description: httpStatusDescription(r.status),
          content: {
            'application/json': {
              schema: r.schema,
            },
          },
        }
      }
    } else {
      // Default response when none declared
      responsesObj['200'] = { description: 'OK' }
    }

    operation.responses = responsesObj

    // Security
    if (meta.bearerAuth) {
      operation.security = [{ bearerAuth: [] }]
    }

    paths[openApiPath][route.method.toLowerCase()] = operation
  }

  const spec: OpenApiSpec = {
    openapi: '3.0.3',
    info: { title, version, ...(description ? { description } : {}) },
    paths,
    components: {},
  }

  if (config.servers && config.servers.length > 0) {
    spec.servers = config.servers
  }

  if (hasBearerAuth) {
    spec.components.securitySchemes = {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    }
  }

  if (tagSet.size > 0) {
    spec.tags = Array.from(tagSet).map(name => ({ name }))
  }

  return spec
}
