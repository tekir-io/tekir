import { RouteTrie } from './trie'
import { captureCallerFile, loadDirEntries, type LoadDirOptions } from '../loader'
import type { MiddlewareFunction, RouteHandler, BodyParserType, LifecycleHook } from '../http/types'

/** Describes a single registered route with its method, path, handler, and metadata. */
export interface RouteDefinition {
  method: string
  path: string
  handler: RouteHandler
  middlewares: MiddlewareFunction[]
  name?: string
  domain?: string
  parse?: BodyParserType | BodyParserType[]
  beforeHandle?: LifecycleHook | LifecycleHook[]
  afterHandle?: LifecycleHook | LifecycleHook[]
  meta: Record<string, unknown>
}


/** Defines a pattern for validating and optionally casting a route parameter. */
export interface ParamMatcher {
  match: RegExp
  cast?: (value: string) => any
}

/** Built-in param matchers for common types (number, uuid, slug). */
export const matchers = {
  number: (): ParamMatcher => ({ match: /^\d+$/, cast: (v) => Number(v) }),
  uuid: (): ParamMatcher => ({ match: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i }),
  slug: (): ParamMatcher => ({ match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ }),
}


/** Fluent builder for configuring a single route (name, middleware, param validation, lifecycle hooks). */
export class RouteBuilder {
  private _wheres: Record<string, ParamMatcher> = {}

  constructor(private def: RouteDefinition) {}

  as(name: string): this {
    this.def.name = name
    return this
  }

  use(middlewares: MiddlewareFunction | MiddlewareFunction[]): this {
    const arr = Array.isArray(middlewares) ? middlewares : [middlewares]
    this.def.middlewares.push(...arr)
    return this
  }

  where(param: string, matcher: ParamMatcher): this {
    this._wheres[param] = matcher
    return this
  }

  /** Restrict this route to a specific domain/subdomain */
  domain(domain: string): this {
    this.def.domain = domain
    return this
  }

  /** Store arbitrary metadata on this route (used by swagger, etc.) */
  meta(key: string, value: unknown): this {
    this.def.meta[key] = value
    return this
  }

  // Body parser type: 'json' | 'text' | 'formdata' | 'urlencoded' | 'none'
  // 'none' skips body parsing entirely (useful for proxy/passthrough)
  parse(type: BodyParserType | BodyParserType[]): this {
    this.def.parse = type
    return this
  }

  // Lifecycle hooks adapted from Elysia's `beforeHandle` / `afterHandle`
  // semantics (`elysia/src/index.ts`, MIT). See packages/tekir-core/NOTICE.md.
  beforeHandle(hook: LifecycleHook | LifecycleHook[]): this {
    this.def.beforeHandle = hook
    return this
  }

  afterHandle(hook: LifecycleHook | LifecycleHook[]): this {
    this.def.afterHandle = hook
    return this
  }

  /** @internal */
  _getWheres(): Record<string, ParamMatcher> { return this._wheres }
}


/** Groups multiple routes under a shared prefix, middleware, and domain. */
export class RouteGroup {
  private _prefix = ''
  private _name = ''
  private _domain = ''
  private _middlewares: MiddlewareFunction[] = []
  private _routes: RouteDefinition[] = []
  private _groups: RouteGroup[] = []
  private _router: Router
  private _built: RouteDefinition[] | null = null

  constructor(private callback: () => void, router: Router) {
    this._router = router
  }

  prefix(prefix: string): this {
    this._prefix = prefix.startsWith('/') ? prefix : `/${prefix}`
    return this
  }

  as(name: string): this {
    this._name = name
    return this
  }

  /** Restrict this group to a specific domain/subdomain. Supports :param placeholders. */
  domain(domain: string): this {
    this._domain = domain
    return this
  }

  use(middlewares: MiddlewareFunction | MiddlewareFunction[]): this {
    const arr = Array.isArray(middlewares) ? middlewares : [middlewares]
    this._middlewares.push(...arr)
    return this
  }

  /** @internal */
  _addRoute(def: RouteDefinition): void { this._routes.push(def) }
  /** @internal */
  _addGroup(group: RouteGroup): void { this._groups.push(group) }

  /** @internal */
  _build(): RouteDefinition[] {
    // Memoize: running the callback twice would re-register every route into
    // `_routes`, duplicating handlers on a second build.
    if (this._built) return this._built
    // Set this group as active on router so router.get/post/etc go into this group
    const prev = this._router['_activeGroup']
    this._router['_activeGroup'] = this
    this.callback()
    this._router['_activeGroup'] = prev

    const defs: RouteDefinition[] = []

    for (const route of this._routes) {
      defs.push({
        ...route,
        path: this._prefix + route.path,
        middlewares: [...this._middlewares, ...route.middlewares],
        name: route.name ? (this._name ? `${this._name}.${route.name}` : route.name) : undefined,
        domain: route.domain || this._domain || undefined,
      })
    }

    for (const group of this._groups) {
      for (const def of group._build()) {
        defs.push({
          ...def,
          path: this._prefix + def.path,
          middlewares: [...this._middlewares, ...def.middlewares],
          name: def.name ? (this._name ? `${this._name}.${def.name}` : def.name) : undefined,
          domain: def.domain || this._domain || undefined,
        })
      }
    }

    this._built = defs
    return defs
  }
}


/** Registers RESTful CRUD routes for a controller (index, create, store, show, edit, update, destroy). */
export class ResourceBuilder {
  private onlyMethods: string[] | null = null
  private exceptMethods: string[] = []
  private _middlewares: Record<string, MiddlewareFunction[]> = {}

  constructor(private router: Router, private basePath: string, private controller: any) {}

  only(methods: string[]): this { this.onlyMethods = methods; return this }
  except(methods: string[]): this { this.exceptMethods = methods; return this }
  apiOnly(): this { this.exceptMethods = ['create', 'edit']; return this }

  use(middlewares: Record<string, MiddlewareFunction[]>): this {
    this._middlewares = middlewares
    return this
  }

  /** @internal */
  _build(): void {
    const path = this.basePath.startsWith('/') ? this.basePath : `/${this.basePath}`
    const actions = [
      { method: 'GET', suffix: '', action: 'index' },
      { method: 'GET', suffix: '/create', action: 'create' },
      { method: 'POST', suffix: '', action: 'store' },
      { method: 'GET', suffix: '/:id', action: 'show' },
      { method: 'GET', suffix: '/:id/edit', action: 'edit' },
      { method: 'PUT', suffix: '/:id', action: 'update' },
      { method: 'DELETE', suffix: '/:id', action: 'destroy' },
    ]

    for (const r of actions) {
      if (this.onlyMethods && !this.onlyMethods.includes(r.action)) continue
      if (this.exceptMethods.includes(r.action)) continue

      const instance = new this.controller()
      if (typeof instance[r.action] !== 'function') continue

      const handler = instance[r.action].bind(instance)
      const middlewares = this._middlewares[r.action] || []
      const name = `${this.basePath.replace(/\//g, '.')}.${r.action}`

      this.router._registerRoute(r.method, `${path}${r.suffix}`, handler, middlewares, name)
    }
  }
}


/** Central router that registers routes, groups, middleware, lifecycle hooks, and compiles them into a trie for fast matching. */
export class Router {
  private trie = new RouteTrie()
  private pendingGroups: RouteGroup[] = []
  private pendingRoutes: Array<{ def: RouteDefinition; builder: RouteBuilder }> = []
  private pendingResources: ResourceBuilder[] = []
  private _globalMiddlewares: MiddlewareFunction[] = []
  private _routerMiddlewares: MiddlewareFunction[] = []
  private _globalWheres: Record<string, ParamMatcher> = {}
  private _activeGroup: RouteGroup | null = null
  private _onRequest: LifecycleHook[] = []
  private _onBeforeHandle: LifecycleHook[] = []
  private _onAfterHandle: LifecycleHook[] = []
  private _onAfterResponse: LifecycleHook[] = []
  private _onError: ((error: Error, ctx: any) => any)[] = []

  // Param matchers (AdonisJS style)
  matchers = matchers


  get(path: string, handler: RouteHandler): RouteBuilder { return this._addRoute('GET', path, handler) }
  post(path: string, handler: RouteHandler): RouteBuilder { return this._addRoute('POST', path, handler) }
  put(path: string, handler: RouteHandler): RouteBuilder { return this._addRoute('PUT', path, handler) }
  delete(path: string, handler: RouteHandler): RouteBuilder { return this._addRoute('DELETE', path, handler) }
  patch(path: string, handler: RouteHandler): RouteBuilder { return this._addRoute('PATCH', path, handler) }
  any(path: string, handler: RouteHandler): RouteBuilder { return this._addRoute('ANY', path, handler) }
  route(path: string, methods: string[], handler: RouteHandler): RouteBuilder {
    const builder = this._addRoute(methods[0], path, handler)
    for (let i = 1; i < methods.length; i++) {
      this._addRoute(methods[i], path, handler)
    }
    return builder
  }

  /**
   * Brisk route — render a view or return data directly without a controller.
   * @example
   * router.on('/about').render(AboutPage, { title: 'About' })
   * router.on('/terms').redirect('/legal')
   * router.on('/health').json({ status: 'ok' })
   */
  on(path: string) {
    const self = this
    return {
      render(component: any, props?: any): RouteBuilder {
        return self._addRoute('GET', path, () => {
          // Try to use view engine if available
          try {

            const { getApp } = require('../container')
            const engine = getApp().use('viewEngine')
            if (engine && engine.render) return engine.render(component, props)
          } catch {}
          // Fallback: if component is a function, call it
          if (typeof component === 'function') return component(props || {})
          return component
        })
      },
      redirect(to: string, status = 302): RouteBuilder {
        return self._addRoute('GET', path, () => new Response(null, { status, headers: { Location: to } }))
      },
      redirectToPath(destination: string, status = 302): RouteBuilder {
        return self._addRoute('GET', path, () => new Response(null, { status, headers: { Location: destination } }))
      },
      redirectToRoute(routeName: string, params?: Record<string, string>, options?: { qs?: Record<string, string>; status?: number }): RouteBuilder {
        return self._addRoute('GET', path, () => {
          const url = self.makeUrl(routeName, params, options?.qs)
          return new Response(null, { status: options?.status || 302, headers: { Location: url } })
        })
      },
      json(data: any): RouteBuilder {
        return self._addRoute('GET', path, () => data)
      },
    }
  }

  // Register decorator-based controllers
  register(...controllers: any[]): this {
    for (const ControllerClass of controllers) {
      const instance = new ControllerClass()
      const prefixes: string[] = ControllerClass.__prefix || ['']
      const routes: any[] = ControllerClass.__routes || []
      const middlewareMap: Record<string, MiddlewareFunction[]> =
        Object.getPrototypeOf(instance).__middlewares || {}

      for (const prefix of prefixes) {
        const normalizedPrefix = prefix ? (prefix.startsWith('/') ? prefix : `/${prefix}`) : ''

        for (const route of routes) {
          let routePath = route.path || ''
          if (routePath === '/') routePath = ''
          else if (routePath && !routePath.startsWith('/')) routePath = `/${routePath}`

          const fullPath = `${normalizedPrefix}${routePath}` || '/'
          const middlewares = middlewareMap[route.methodName] || []
          if (route.method === 'WS') continue

          const originalMethod = instance[route.methodName]
          let handler: any = originalMethod.bind(instance)
          handler.__source = originalMethod.toString()
          handler.__original = originalMethod

          const wheres = route.options?.where
          if (wheres && Object.keys(wheres).length > 0) {
            const inner = handler
            handler = (ctx: any) => {
              for (const [param, matcher] of Object.entries(wheres) as any) {
                const value = ctx.params[param]
                if (value !== undefined && !matcher.match.test(value)) {
                  return ctx.response?.notFound?.({ message: `Invalid param: ${param}` })
                    ?? new Response(JSON.stringify({ message: `Invalid param: ${param}` }), { status: 404, headers: { 'Content-Type': 'application/json' } })
                }
                if (value !== undefined && matcher.cast) ctx.params[param] = matcher.cast(value)
              }
              return inner(ctx)
            }
            handler.__source = inner.__source
          }

          this._registerRoute(route.method, fullPath, handler, middlewares, route.options?.name)
        }
      }
    }
    return this
  }


  /**
   * Load every file in a directory and register whatever each module
   * exports against this router. Auto-detects three common patterns:
   *
   * 1. **Decorator controller** (a class with `@Controller` + `@Get/@Post/...`):
   *    the class is passed to {@link Router.register}.
   * 2. **Functional registrar** (`export default (router) => { ... }`):
   *    the function is invoked with this router so it can call
   *    `router.get(...)` etc. directly.
   * 3. **Class with a `register(router)` method**: a fresh instance is
    *    constructed and its `register` method is invoked. Use this when
   *    you want to attach routes without decorators while keeping the
   *    file's primary export as a class.
   *
   * Files whose default export does not match any pattern are skipped
   * with a `console.warn` so misconfigured exports surface during boot
   * instead of failing silently at request time.
   *
   * @example
   * ```ts
   * // Replaces the long `import` + `register(Auth, Projects, ...)` block
   * await router.registerDir('app/controllers')
   * ```
   *
   * @param dir Directory. Absolute paths are used as-is. Relative paths
   *   default to the caller's own directory (file-relative, captured via
   *   stack inspection so `await router.registerDir('./controllers')`
   *   from `api/index.ts` resolves to `api/controllers` no matter what
   *   the cwd is). Pass `options.from = import.meta.url` to set the
   *   base explicitly, or `options.from = process.cwd()` to keep the
   *   pre-0.1.15 cwd-relative behavior.
   * @param options Forwarded to `loadDir`. See `LoadDirOptions`.
   * @returns This router, for chaining.
   *
   * Note: dynamic imports cannot be statically traced by
   * `bun build --compile`. For single-executable builds keep an
   * explicit `import` list and pass it to {@link Router.register}.
   */
  async registerDir(dir: string, options?: LoadDirOptions): Promise<this> {
    // Capture the caller's file SYNCHRONOUSLY before any `await` runs —
    // once the function suspends at an await, the synchronous stack that
    // had the user's call site is gone and the post-resume stack only
    // contains the JS engine's microtask machinery (Bun emits frames
    // like `native:1:11` for these). Top-level static imports for
    // `captureCallerFile`/`loadDirEntries` keep this synchronous.
    //
    // `options.from` always wins; if stack inspection cannot pin down a
    // user frame, `loadDirEntries` falls back to `process.cwd()`.
    const from = options?.from ?? captureCallerFile(this.registerDir)
    const entries = await loadDirEntries<any>(dir, { ...options, from })
    if (entries.length === 0) {
       
      console.warn(
        `[router.registerDir] No modules loaded from "${dir}" (resolved against ${from ?? 'cwd: ' + process.cwd()}). ` +
        `If this is a production bundle outside of \`bun build --compile\`, the AST inliner that ` +
        `replaces literal-string \`registerDir\` calls did not run. Add the plugin to your build: ` +
        `\`Bun.build({ plugins: [await (await import('@tekir/core')).createInlinerPlugin()] })\`, ` +
        `or use \`bun build --compile\` so the tekir CLI auto-injects it.`,
      )
    }
    for (const { file, picked: mod } of entries) {
      // Decorator-based class: ControllerClass.__prefix or .__routes set
      // by `@Controller`/`@Get`/etc. Pass straight through to register().
      if (mod && (mod.__prefix !== undefined || mod.__routes !== undefined)) {
        this.register(mod)
        continue
      }
      // Plain function (arrow or factory) — invoke it with the router.
      // Filter out classes (which also have typeof === 'function') by
      // checking for the absence of a non-empty prototype.
      if (typeof mod === 'function' && (!mod.prototype || Object.getOwnPropertyNames(mod.prototype).length === 1)) {
        await mod(this)
        continue
      }
      // Class instance pattern: `class Foo { register(router) { ... } }`
      if (typeof mod === 'function' && typeof mod.prototype?.register === 'function') {
        const instance = new mod()
        await instance.register(this)
        continue
      }
      // Pre-built object with a register method: `export default { register(router) { ... } }`
      if (mod && typeof mod === 'object' && typeof (mod as any).register === 'function') {
        await (mod as any).register(this)
        continue
      }
      // Nothing matched. Surface it loudly with the source file path so
      // a typo in the export does not silently drop a controller from
      // the routing table.
      const name = mod?.constructor?.name || (typeof mod === 'function' ? mod.name : typeof mod)
       
      console.warn(`[router.registerDir] ${file}: skipped (unrecognized export shape: ${name || '<unknown>'})`)
    }
    return this
  }

  resource(basePath: string, controller: any): ResourceBuilder {
    const rb = new ResourceBuilder(this, basePath, controller)
    this.pendingResources.push(rb)
    return rb
  }


  group(callback: () => void): RouteGroup {
    const group = new RouteGroup(callback, this)
    if (this._activeGroup) {
      this._activeGroup._addGroup(group)
    } else {
      this.pendingGroups.push(group)
    }
    return group
  }


  where(param: string, matcher: ParamMatcher): this {
    this._globalWheres[param] = matcher
    return this
  }


  useGlobal(middleware: MiddlewareFunction | MiddlewareFunction[]): this {
    const arr = Array.isArray(middleware) ? middleware : [middleware]
    this._globalMiddlewares.push(...arr)
    return this
  }

  useRouter(middleware: MiddlewareFunction | MiddlewareFunction[]): this {
    const arr = Array.isArray(middleware) ? middleware : [middleware]
    this._routerMiddlewares.push(...arr)
    return this
  }



  onRequest(hook: LifecycleHook): this { this._onRequest.push(hook); return this }
  onBeforeHandle(hook: LifecycleHook): this { this._onBeforeHandle.push(hook); return this }
  onAfterHandle(hook: LifecycleHook): this { this._onAfterHandle.push(hook); return this }
  onAfterResponse(hook: LifecycleHook): this { this._onAfterResponse.push(hook); return this }
  onError(hook: (error: Error, ctx: any) => any): this { this._onError.push(hook); return this }


  makeUrl(name: string, params?: Record<string, string>, qs?: Record<string, string>): string {
    return this.trie.makeUrl(name, params, qs)
  }


  private _addRoute(method: string, path: string, handler: RouteHandler): RouteBuilder {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const def: RouteDefinition = { method, path: normalizedPath, handler, middlewares: [], meta: {} }
    const builder = new RouteBuilder(def)

    if (this._activeGroup) {
      this._activeGroup._addRoute(def)
    } else {
      this.pendingRoutes.push({ def, builder })
    }

    return builder
  }

  /** @internal - used by ResourceBuilder */
  _registerRoute(method: string, path: string, handler: RouteHandler, middlewares: MiddlewareFunction[], name?: string): void {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const def: RouteDefinition = { method, path: normalizedPath, handler, middlewares, name, meta: {} }
    this.pendingRoutes.push({ def, builder: new RouteBuilder(def) })
  }

  compile(): void {
    // Build resources first
    for (const rb of this.pendingResources) rb._build()

    // Register direct routes with param validation middleware
    for (const { def, builder } of this.pendingRoutes) {
      const wheres = { ...this._globalWheres, ...builder._getWheres() }
      let handler = def.handler

      // Wrap handler with param validation if .where() is used
      if (Object.keys(wheres).length > 0) {
        const originalHandler = handler
        handler = (ctx: any) => {
          for (const [param, matcher] of Object.entries(wheres)) {
            const value = ctx.params[param]
            if (value !== undefined && !matcher.match.test(value)) {
              return ctx.response.notFound({ message: `Invalid param: ${param}` })
            }
            if (value !== undefined && matcher.cast) {
              ctx.params[param] = matcher.cast(value)
            }
          }
          return originalHandler(ctx)
        }
      }

      const allMiddlewares = [...this._routerMiddlewares, ...def.middlewares]
      this.trie.add(def.method, def.path, handler, allMiddlewares, def.name, def.meta)
    }

    // Register group routes
    for (const group of this.pendingGroups) {
      for (const def of group._build()) {
        const allMiddlewares = [...this._routerMiddlewares, ...def.middlewares]
        this.trie.add(def.method, def.path, def.handler, allMiddlewares, def.name, def.meta)
      }
    }
  }

  match(method: string, path: string) { return this.trie.match(method, path) }
  get globalMiddlewares(): MiddlewareFunction[] { return this._globalMiddlewares }
  get routerMiddlewares(): MiddlewareFunction[] { return this._routerMiddlewares }
  get hooks() {
    return {
      onRequest: this._onRequest,
      onBeforeHandle: this._onBeforeHandle,
      onAfterHandle: this._onAfterHandle,
      onAfterResponse: this._onAfterResponse,
      onError: this._onError,
    }
  }
  getTrie(): RouteTrie { return this.trie }
}
