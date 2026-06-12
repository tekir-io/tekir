import { isTC39Decorator, getOrInitMap } from './utils'
import type { MiddlewareFunction } from '@tekir/core'

/**
 * Method decorator that attaches middleware functions to a controller method.
 *
 * @param {MiddlewareFunction[]} middlewares - Array of middleware functions to apply
 * @returns {MethodDecorator} A method decorator
 *
 * @example
 * ```ts
 * @Middleware([auth(), rateLimit(100)])
 * @Get('/')
 * getAll() { ... }
 * ```
 */
export function Middleware(middlewares: MiddlewareFunction[]): any {
  return (target: any, context?: any) => {
    if (isTC39Decorator(context)) {
      const methodName = String(context.name)
      context.addInitializer(function (this: any) {
        const proto = Object.getPrototypeOf(this)
        const map = getOrInitMap(proto, '__middlewares')
        if (!map[methodName]) {
          map[methodName] = []
        }
        map[methodName].push(...middlewares)
      })
      return target
    }

    // Legacy decorator: middleware is recorded as a side effect on the
    // prototype map. Returning nothing leaves the original method descriptor
    // untouched (returning `target[methodName]` here was meaningless — a legacy
    // method decorator's return value is treated as a property descriptor).
    const methodName = context as string
    const proto = target
    const map = getOrInitMap(proto, '__middlewares')
    if (!map[methodName]) {
      map[methodName] = []
    }
    map[methodName].push(...middlewares)
  }
}
