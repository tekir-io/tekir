import type { ApiParamOptions, EndpointMeta } from './types'
import { getMeta } from './types'
import { zodToJsonSchema } from './zod_to_schema'


// TC39 method decorator helper — stores metadata on the function itself
function applyMeta(patch: (m: EndpointMeta) => void) {
  return (target: any, _context?: any) => {
    patch(getMeta(target))
    return target
  }
}

/**
 * Decorator that groups endpoint(s) under one or more OpenAPI tags.
 * @param {...string} tags - Tag names to assign
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiTag('Users')
 * getAll() { ... }
 * ```
 */
export function ApiTag(...tags: string[]) {
  return applyMeta(m => { m.tags = [...(m.tags || []), ...tags] })
}

/**
 * Decorator that sets a short summary description for the endpoint in OpenAPI.
 * @param {string} summary - The summary text
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiSummary('Get all users')
 * getAll() { ... }
 * ```
 */
export function ApiSummary(summary: string) {
  return applyMeta(m => { m.summary = summary })
}

/**
 * Decorator that sets the request body schema for the endpoint (Zod or JSON Schema).
 * @param {unknown} schema - A Zod schema or plain JSON Schema object
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiBody(z.object({ name: z.string(), email: z.string().email() }))
 * create() { ... }
 * ```
 */
export function ApiBody(schema: unknown) {
  return applyMeta(m => { m.body = zodToJsonSchema(schema) })
}

/**
 * Decorator that documents a response schema for a given HTTP status code.
 * @param {number} statusCode - The HTTP status code
 * @param {unknown} schema - A Zod schema or plain JSON Schema object for the response body
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiResponse(200, z.object({ id: z.number(), name: z.string() }))
 * getUser() { ... }
 * ```
 */
export function ApiResponse(statusCode: number, schema: unknown) {
  return applyMeta(m => {
    if (!m.responses) m.responses = []
    m.responses.push({ status: statusCode, schema: zodToJsonSchema(schema) })
  })
}

/**
 * Decorator that documents a path or query parameter for the endpoint.
 * @param {string} name - The parameter name
 * @param {ApiParamOptions} [options={}] - Parameter options (type, format, description, required, example)
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiParam('id', { type: 'integer', description: 'User ID' })
 * getUser() { ... }
 * ```
 */
export function ApiParam(name: string, options: ApiParamOptions = {}) {
  return applyMeta(m => {
    if (!m.params) m.params = []
    m.params.push({ name, options })
  })
}

/**
 * Decorator that marks an endpoint as requiring Bearer token authentication.
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiBearerAuth()
 * getProfile() { ... }
 * ```
 */
export function ApiBearerAuth() {
  return applyMeta(m => { m.bearerAuth = true })
}

/**
 * Decorator that hides an endpoint from the generated OpenAPI spec. Use it on
 * internal, admin, debug, or webhook handlers that should not appear in the
 * public docs or route map.
 * @returns {Function} Method decorator
 *
 * @example
 * ```ts
 * @ApiHide()
 * internalMetrics() { ... }
 * ```
 */
export function ApiHide() {
  return applyMeta(m => { m.hidden = true })
}
