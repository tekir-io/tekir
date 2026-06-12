/**
 * `@Cache` route decorator: sugar for attaching the `cache()` middleware
 * from `@tekir/cache` to a controller method.
 *
 * @example
 * ```ts
 * import { Controller, Get } from '@tekir/http-decorators'
 * import { Cache } from '@tekir/http-decorators'
 *
 * @Controller('/api/posts')
 * class PostsController {
 *   @Get('/')
 *   @Cache({ ttl: 60 })
 *   async list() {
 *     return Post.all()
 *   }
 * }
 * ```
 *
 * Note: `@tekir/cache` is an optional peer dependency. It is required lazily,
 * only when `@Cache(...)` is actually used, so importing `@tekir/http-decorators`
 * (or any other decorator from it) does not pull in `@tekir/cache`.
 */
import { Middleware } from "./middleware"
import type { HttpCacheOptions } from "@tekir/cache"

export function Cache(opts: HttpCacheOptions = {}): any {
  // Lazy require so projects that never use @Cache don't need @tekir/cache.
  let cacheMw: (o: HttpCacheOptions) => unknown
  try {
    cacheMw = (require("@tekir/cache") as typeof import("@tekir/cache")).cache
  } catch (err) {
    throw new Error(
      "[http-decorators] @Cache requires the optional peer dependency '@tekir/cache'. " +
      "Install it to use this decorator. " +
      `(${err instanceof Error ? err.message : String(err)})`,
    )
  }
  return Middleware([cacheMw(opts) as any])
}
