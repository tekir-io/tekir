import type { ShieldContext, MiddlewareFn, RateLimitInfo } from './types'

// Rate-limit headers helpers

/**
 * Apply standard rate-limit response headers to the current context.
 *
 * Designed to work alongside `@tekir/limiter` — pass the limiter's result
 * object here and the headers will be set automatically.
 *
 * Sets:
 *  - `RateLimit-Limit`
 *  - `RateLimit-Remaining`
 *  - `RateLimit-Reset`
 *  - `Retry-After` (only when `retryAfter` is provided)
 *
 * @example
 * // In a route handler or middleware:
 * const info = await limiter.check(ctx);
 * setRateLimitHeaders(ctx, info);
 * if (info.remaining < 0) ctx.throw(429, 'Too Many Requests');
 */
export function setRateLimitHeaders(
  ctx: ShieldContext,
  info: RateLimitInfo
): void {
  ctx.response.setHeader("RateLimit-Limit", String(info.limit))
  ctx.response.setHeader(
    "RateLimit-Remaining",
    String(Math.max(0, info.remaining))
  )
  ctx.response.setHeader("RateLimit-Reset", String(info.reset))
  if (info.retryAfter !== undefined) {
    ctx.response.setHeader("Retry-After", String(info.retryAfter))
  }
}

/**
 * Middleware factory that integrates with a rate-limit checker function.
 *
 * @param checker - An async function that receives the context and returns
 *   a `RateLimitInfo` object. Throw or call `ctx.throw(429, ...)` inside
 *   the checker to block the request.
 *
 * @example
 * import { rateLimitHeaders } from '@tekir/shield';
 * import { createLimiter } from '@tekir/limiter';
 *
 * const limiter = createLimiter({ max: 100, window: 60 });
 *
 * router.useGlobal([
 *   rateLimitHeaders(async (ctx) => limiter.check(ctx.request)),
 * ]);
 */
export function rateLimitHeaders(
  checker: (ctx: ShieldContext) => Promise<RateLimitInfo>
): MiddlewareFn {
  return async (ctx: ShieldContext, next: () => Promise<void>): Promise<void> => {
    const info = await checker(ctx)
    setRateLimitHeaders(ctx, info)
    await next()
  }
}
