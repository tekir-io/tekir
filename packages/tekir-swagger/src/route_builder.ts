import { zodToJsonSchema } from './zod_to_schema'

declare module '@tekir/core' {
  interface RouteBuilder {
    /** Set OpenAPI summary for this route */
    summary(text: string): this
    /** Set OpenAPI request body schema (Zod or JSON Schema) */
    apiBody(schema: unknown): this
    /** Add OpenAPI response schema for a status code */
    apiResponse(statusCode: number, schema: unknown): this
    /** Add OpenAPI path parameter documentation */
    apiParam(name: string, options?: { type?: string; description?: string }): this
    /** Mark this route as requiring Bearer authentication */
    bearerAuth(): this
    /** Set OpenAPI tags for this route */
    apiTag(...tags: string[]): this
    /** Hide this route from the generated OpenAPI spec */
    apiHide(): this
  }
}

try {

  const { RouteBuilder } = require('@tekir/core')
  const proto = RouteBuilder.prototype

  proto.summary = function(text: string) { return this.meta('swagger:summary', text) }
  proto.apiBody = function(schema: unknown) { return this.meta('swagger:body', zodToJsonSchema(schema)) }
  proto.apiResponse = function(statusCode: number, schema: unknown) {
    const existing = (this as any).def.meta['swagger:responses'] || []
    existing.push({ status: statusCode, schema: zodToJsonSchema(schema) })
    return this.meta('swagger:responses', existing)
  }
  proto.apiParam = function(name: string, options?: { type?: string; description?: string }) {
    const existing = (this as any).def.meta['swagger:params'] || []
    existing.push({ name, options: options || {} })
    return this.meta('swagger:params', existing)
  }
  proto.bearerAuth = function() { return this.meta('swagger:bearerAuth', true) }
  proto.apiTag = function(...tags: string[]) { return this.meta('swagger:tags', tags) }
  proto.apiHide = function() { return this.meta('swagger:hidden', true) }
} catch (err) {
  // The fluent swagger API is best-effort: if @tekir/core can't be required
  // (e.g. ESM-only context), surface why on the debug channel instead of
  // failing silently, so a later `.summary() is not a function` is diagnosable.
  const debug = (globalThis as any).process?.env?.DEBUG
  if (debug) {
    const log = (globalThis as any).console?.warn
    if (log) log(`[swagger] RouteBuilder fluent API not patched: ${(err as Error)?.message ?? err}`)
  }
}
