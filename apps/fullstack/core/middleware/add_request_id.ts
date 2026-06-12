import type { HttpContext } from '@tekir/core'

/**
 * After middleware example — adds X-Request-Id header to every response.
 * Runs AFTER the handler, manipulates the response.
 */
export default async function addRequestId(ctx: HttpContext, next: () => Promise<void>) {
  // Before: set request id on context
  const requestId = crypto.randomUUID()
  ctx.store.requestId = requestId

  // Run handler + remaining middleware
  await next()

  // After: wrap response with extra header
  const result = ctx.$result
  if (result instanceof Response) {
    result.headers.set('X-Request-Id', requestId)
  } else if (result && typeof result === 'object') {
    ctx.$result = Response.json(result, {
      headers: { 'X-Request-Id': requestId, 'Content-Type': 'application/json' },
    })
  }
}
