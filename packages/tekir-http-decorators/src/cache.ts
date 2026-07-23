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
import { createRequire } from "node:module"
import { Middleware } from "./middleware"
import type { HttpCacheOptions } from "@tekir/cache"

const localRequire = createRequire(import.meta.url)
let cacheMiddleware: ((options: HttpCacheOptions) => unknown) | undefined

try {
  const cacheModule = import.meta.resolve("@tekir/cache")
  cacheMiddleware = (localRequire(cacheModule) as typeof import("@tekir/cache")).cache
} catch {}

export function Cache(opts: HttpCacheOptions = {}): any {
  if (!cacheMiddleware) {
    throw new Error(
      "[http-decorators] @Cache requires the optional peer dependency '@tekir/cache'. " +
      "Install it to use this decorator.",
    )
  }
  return Middleware([cacheMiddleware(opts) as any])
}
