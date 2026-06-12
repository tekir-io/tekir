import type { Router, MiddlewareFunction } from '@tekir/core'
import type { RouteMetadata } from './types'

/**
 * Manages registration and loading of decorated controller classes into a router.
 *
 * @example
 * ```ts
 * const manager = new ControllerManager()
 * manager.register(UserController, PostController)
 * manager.load(router)
 * ```
 */
export class ControllerManager {
  private _controllers: any[] = []

  /**
   * Register one or more controller classes.
   * @param {...any} controllers - Controller classes decorated with @Controller
   * @returns {this} The manager instance for chaining
   */
  register(...controllers: any[]): this {
    this._controllers.push(...controllers)
    return this
  }

  get count() { return this._controllers.length }

  /**
   * Instantiate all registered controllers and load their routes into the router.
   * Applies middleware, param validation, and method binding.
   * @param {Router} router - The Tekir router to register routes on
   * @returns {void}
   */
  load(router: Router): void {

    for (const ControllerClass of this._controllers) {
      // A controller whose constructor throws must not bring down every other
      // controller's routing — skip it with a warning and continue.
      let instance: any
      try {
        instance = new ControllerClass()
      } catch (err) {
        console.warn(
          `[http-decorators] Skipped controller "${ControllerClass?.name ?? '<anonymous>'}": ` +
          `constructor threw (${err instanceof Error ? err.message : String(err)}).`,
        )
        continue
      }

      const controllerName = ControllerClass?.name ?? '<anonymous>'
      const prefixes: string[] = ControllerClass.__prefix || ['']
      const routes: RouteMetadata[] = ControllerClass.__routes || []
      const middlewareMap: Record<string, MiddlewareFunction[]> =
        Object.getPrototypeOf(instance).__middlewares || {}

      for (const prefix of prefixes) {
        const normalizedPrefix = prefix
          ? prefix.startsWith('/')
            ? prefix
            : `/${prefix}`
          : ''

        for (const route of routes) {
          let routePath = route.path || ''
          // Don't add leading slash if path is just '/' (to avoid double slash)
          if (routePath === '/') {
            routePath = ''
          } else if (routePath && !routePath.startsWith('/')) {
            routePath = `/${routePath}`
          }

          const fullPath = `${normalizedPrefix}${routePath}` || '/'
          const middlewares = middlewareMap[route.methodName] || []
          const method = route.method

          if (method === 'WS') {
            // WS routing is not implemented in this package yet. Warn rather
            // than silently dropping so a @Websocket route doesn't look wired.
            console.warn(
              `[http-decorators] ${controllerName}.${route.methodName}: ` +
              `@Websocket routes are not yet supported and were skipped.`,
            )
            continue
          }

          // The resolved handler must actually be a function. If metadata names
          // a method that doesn't exist on the instance (e.g. mixed decorator
          // runtimes or a renamed method), skip this one route with a warning
          // instead of throwing and aborting every remaining route.
          const originalMethod = instance[route.methodName]
          if (typeof originalMethod !== 'function') {
            console.warn(
              `[http-decorators] ${controllerName}: route handler "${route.methodName}" ` +
              `is not a function on the instance — route ${method} ${fullPath} skipped.`,
            )
            continue
          }

          // Bind method but preserve original source for compiler inference
          let handler: any = originalMethod.bind(instance)
          handler.__source = originalMethod.toString()

          // Apply .where() param validation if specified in route options
          const wheres = route.options?.where
          if (wheres && Object.keys(wheres).length > 0) {
            const innerHandler = handler
            handler = (ctx: any) => {
              for (const [param, matcher] of Object.entries(wheres)) {
                const value = ctx.params[param]
                if (value !== undefined && !testMatcher(matcher.match, value)) {
                  return new Response(JSON.stringify({ message: `Invalid param: ${param}` }), { status: 404, headers: { 'Content-Type': 'application/json' } })
                }
                if (value !== undefined && matcher.cast) {
                  ctx.params[param] = matcher.cast(value)
                }
              }
              return innerHandler(ctx)
            }
            handler.__source = innerHandler.__source
          }

          const trie = router.getTrie()
          trie.add(method, fullPath, handler, middlewares, route.options?.name)
        }
      }
    }

    // Route registration is silent — use logger if needed
  }
}

// Test a value against a user-supplied matcher regex without the stateful
// `.test()` pitfall: a regex defined with the `g` or `y` flag advances
// `lastIndex` between calls, so consecutive requests to the same route would
// flip-flop between match/no-match. Reset lastIndex (or run on a flagless copy)
// to make matching deterministic.
function testMatcher(re: RegExp, value: string): boolean {
  if (re.global || re.sticky) {
    re.lastIndex = 0
    const ok = re.test(value)
    re.lastIndex = 0
    return ok
  }
  return re.test(value)
}
