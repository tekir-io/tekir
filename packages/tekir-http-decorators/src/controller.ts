import { isTC39Decorator, getOrInitArray } from './utils'

/**
 * Class decorator that marks a class as an HTTP controller with route prefix(es).
 * Collects route metadata from decorated methods for registration.
 *
 * @param {string | string[]} [prefix=''] - The route prefix or array of prefixes
 * @returns {ClassDecorator} A class decorator
 *
 * @example
 * ```ts
 * @Controller('/api/users')
 * class UserController {
 *   @Get('/') getAll() { ... }
 *   @Post('/') create() { ... }
 * }
 * ```
 */
export function Controller(prefix: string | string[] = ''): any {
  const prefixes = Array.isArray(prefix) ? prefix : [prefix]

  return (target: any, context?: any) => {
    target.__prefix = prefixes

    if (isTC39Decorator(context)) {
      // TC39 class decorator: collect routes from method __routeMeta
      const routes: any[] = []
      const proto = target.prototype
      const names = Object.getOwnPropertyNames(proto)
      for (const name of names) {
        if (name === 'constructor') continue
        const method = proto[name]
        if (typeof method === 'function' && method.__routeMeta) {
          routes.push(...method.__routeMeta)
        }
      }
      target.__routes = routes
      return target
    }

    // Legacy decorator fallback
    getOrInitArray(target, '__routes')
    return target
  }
}
