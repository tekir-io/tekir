/**
 * Contract for service providers that hook into the application lifecycle.
 * Implement `register` to bind services, `boot` to run after all providers are registered,
 * and `shutdown` to clean up resources on application teardown.
 */
export interface ServiceProvider {
  register?(app: App): void | Promise<void>
  boot?(app: App): void | Promise<void>
  shutdown?(app: App): void | Promise<void>
}

/**
 * Application container that manages service bindings, singletons, and provider lifecycle.
 *
 * @example
 * const app = createApp()
 * app.singleton('db', () => new Database(config))
 * app.register(new AuthProvider())
 * await app.boot()
 * const db = app.use<Database>('db')
 */
export class App {
  private services = new Map<string, any>()
  private providers: ServiceProvider[] = []
  private _booted = false

  /**
   * Register a transient service factory. A new instance is created on every `use()` call.
   * @param name - Unique service identifier
   * @param factory - Factory function that creates the service instance
   * @returns The app instance for chaining
   */
  bind<T>(name: string, factory: () => T): this {
    this.services.set(name, { factory, instance: null, singleton: false })
    return this
  }

  /**
   * Register a singleton service factory. The instance is created once on first `use()` call and cached.
   * @param name - Unique service identifier
   * @param factory - Factory function that creates the service instance
   * @returns The app instance for chaining
   */
  singleton<T>(name: string, factory: () => T): this {
    this.services.set(name, { factory, instance: null, singleton: true })
    return this
  }

  /**
   * Register a pre-created instance directly into the container.
   * @param name - Unique service identifier
   * @param value - The instance to store
   * @returns The app instance for chaining
   */
  instance(name: string, value: any): this {
    this.services.set(name, { factory: null, instance: value, singleton: true })
    return this
  }

  /**
   * Resolve a service from the container by name. Throws if the service is not registered.
   *
   * Security: `name` is a trusted service identifier. NEVER pass a
   * user-controlled value (e.g. `ctx.input('service')`) here — doing so lets a
   * request resolve an arbitrary registered service (db, mailer) and is an
   * IDOR / service-abuse footgun. Keep an explicit allow-list at the call site
   * if a name must ever derive from input.
   *
   * @param name - The service identifier to resolve
   * @returns The resolved service instance
   * @throws {Error} If the service is not registered
   */
  use<T = any>(name: string): T {
    const entry = this.services.get(name)
    if (!entry) throw new Error(`Service "${name}" not registered`)

    if (entry.singleton && entry.instance !== null) return entry.instance
    if (!entry.factory) return entry.instance

    const instance = entry.factory()
    if (entry.singleton) entry.instance = instance
    return instance
  }

  /**
   * Check whether a service is registered in the container.
   * @param name - The service identifier to check
   * @returns True if the service exists
   */
  has(name: string): boolean {
    return this.services.has(name)
  }

  /**
   * Register a single service provider.
   * @param provider - The service provider instance to register
   * @returns The app instance for chaining
   */
  register(provider: ServiceProvider): this {
    this.providers.push(provider)
    return this
  }

  /**
   * Register multiple service providers at once. Accepts both instances and constructor classes.
   * @param providers - Array of provider instances or provider constructors
   * @returns The app instance for chaining
   */
  registerAll(providers: (ServiceProvider | (new () => ServiceProvider))[]): this {
    for (const P of providers) {
      this.providers.push(typeof P === 'function' ? new (P as any)() : P)
    }
    return this
  }

  /**
   * Returns every registered provider instance. Used by `tekir()` to
   * collect provider-exposed CLI commands (`Provider.commands`).
   */
  getProviders(): ServiceProvider[] {
    return this.providers
  }

  /**
   * Boot all registered providers in two phases: register, then boot.
   * Safe to call multiple times; subsequent calls are no-ops.
   * @returns A promise that resolves when all providers have booted
   */
  async boot(): Promise<void> {
    if (this._booted) return

    // Phase 1: register
    for (const p of this.providers) {
      if (p.register) await p.register(this)
    }

    // Phase 2: boot
    for (const p of this.providers) {
      if (p.boot) await p.boot(this)
    }

    this._booted = true
  }

  /**
   * Gracefully shut down all providers in reverse registration order.
   * @returns A promise that resolves when all providers have been shut down
   */
  async shutdown(): Promise<void> {
    // Copy before reversing so repeated boot()/shutdown() cycles keep the
    // original registration order (in-place `.reverse()` was not idempotent).
    for (const p of [...this.providers].reverse()) {
      if (p.shutdown) await p.shutdown(this)
    }
  }

  get booted(): boolean {
    return this._booted
  }
}

// Global app instance
let _app: App | null = null

/**
 * Create and return a new global App instance.
 * @returns A fresh App container
 */
export function createApp(): App {
  _app = new App()
  return _app
}
