import { AuthorizationResponse, ForbiddenException, normalizeResult } from './types'
import type { AbilityCallback, BeforeHook, AbilityResult } from './types'
import { BasePolicy, PolicyProxy } from './policy'

/**
 * Central authorization manager for defining abilities (gates) and policies.
 *
 * @example
 * ```ts
 * const auth = new Authorize()
 * auth.define('edit-post', (user, post) => user.id === post.authorId)
 * auth.registerPolicy('post', PostPolicy)
 *
 * await auth.authorize('edit-post', currentUser, post)
 * ```
 */
export class Authorize {
  private readonly abilities: Map<string, AbilityCallback> = new Map()
  private readonly beforeHooks: BeforeHook[] = []
  private readonly policies: Map<string, new () => BasePolicy> = new Map()
  private readonly policyProxyCache: Map<string, PolicyProxy> = new Map()

  // Abilities (Gates)

  /**
   * Define a named ability (gate).
   * @param {string} name - The ability name
   * @param {AbilityCallback} callback - Callback that receives (user, ...args) and returns an ability result
   * @returns {this} The Authorize instance for chaining
   *
   * @example
   * ```ts
   * auth.define('delete-user', (user) => user.role === 'admin')
   * ```
   */
  define(name: string, callback: AbilityCallback): this {
    this.abilities.set(name, callback)
    return this
  }

  /**
   * Register a before-hook that runs before each individual ability check.
   * The hook decides PER ABILITY: inspect the `ability` argument and return
   * `true`/`false` (or an `AuthorizationResponse`) only for the abilities you
   * mean to decide; return `undefined` to defer to the ability itself.
   *
   * A bare `false` denies only the ability being checked, never all of them.
   * Returning anything other than a boolean/`AuthorizationResponse` is ignored
   * (with a warning) so a stray value cannot silently lock authorization.
   *
   * @param {BeforeHook} hook - The before-hook function
   * @returns {this} The Authorize instance for chaining
   *
   * @example
   * ```ts
   * // Grant admins everything, but stay neutral for everyone else.
   * auth.before((user) => (user as any)?.isAdmin ? true : undefined)
   * ```
   */
  before(hook: BeforeHook): this {
    this.beforeHooks.push(hook)
    return this
  }

  /**
   * Run all before-hooks sequentially for a SINGLE ability. Each hook receives
   * the ability name so it can decide per-ability — a hook is meant to inspect
   * `ability` and only short-circuit the checks it actually intends to.
   *
   * Short-circuit semantics (per-ability, never global):
   *   - `true`  / `AuthorizationResponse.allow()` → allow THIS ability
   *   - `false` / `AuthorizationResponse.deny()`   → deny THIS ability
   *   - `undefined` / `null`                       → defer to the next hook / the ability itself
   *
   * @param {unknown} user - The user to check
   * @param {string} ability - The ability name
   * @param {...unknown} args - Additional arguments
   * @returns {Promise<AbilityResult>} The first explicit decision, or undefined
   */
  async runBeforeHooks(user: unknown, ability: string, ...args: unknown[]): Promise<AbilityResult> {
    for (const hook of this.beforeHooks) {
      const result = await hook(user, ability, ...args)
      if (result === undefined || result === null) continue
      // Only a strict boolean or an AuthorizationResponse is a real decision.
      // A truthy non-boolean (e.g. an accidental object) would otherwise be
      // coerced to deny by normalizeResult and silently lock the ability —
      // surface that mistake instead of acting on it.
      if (typeof result !== 'boolean' && !(result instanceof AuthorizationResponse)) {
        console.warn(
          `[@tekir/authorize] before-hook for ability "${ability}" returned a non-boolean, ` +
          'non-AuthorizationResponse value; ignoring it and deferring to the ability. ' +
          'Return true/false or AuthorizationResponse to make a decision.',
        )
        continue
      }
      return result
    }
    return undefined
  }

  // Resolve an ability by name, running before-hooks first
  private async resolveAbility(name: string, user: unknown, ...args: unknown[]): Promise<AuthorizationResponse> {
    // Before-hooks can short-circuit
    const beforeResult = await this.runBeforeHooks(user, name, ...args)
    if (beforeResult !== undefined) {
      return normalizeResult(beforeResult)
    }

    const callback = this.abilities.get(name)
    if (!callback) {
      return AuthorizationResponse.deny(`Ability "${name}" is not defined`)
    }

    const raw = await callback(user, ...args)
    return normalizeResult(raw)
  }

  /**
   * Check if the ability is granted for the given user.
   * @param {string} name - The ability name
   * @param {unknown} user - The user to check
   * @param {...unknown} args - Additional arguments passed to the ability callback
   * @returns {Promise<boolean>} True if the ability is granted
   *
   * @example
   * ```ts
   * if (await auth.allows('edit-post', user, post)) { ... }
   * ```
   */
  async allows(name: string, user: unknown, ...args: unknown[]): Promise<boolean> {
    const response = await this.resolveAbility(name, user, ...args)
    return response.allowed
  }

  /**
   * Check if the ability is denied for the given user.
   * @param {string} name - The ability name
   * @param {unknown} user - The user to check
   * @param {...unknown} args - Additional arguments passed to the ability callback
   * @returns {Promise<boolean>} True if the ability is denied
   */
  async denies(name: string, user: unknown, ...args: unknown[]): Promise<boolean> {
    return !(await this.allows(name, user, ...args))
  }

  /**
   * Assert that the ability is granted. Throws ForbiddenException if denied.
   * @param {string} name - The ability name
   * @param {unknown} user - The user to check
   * @param {...unknown} args - Additional arguments
   * @returns {Promise<void>}
   * @throws {ForbiddenException} If the ability is denied
   */
  async authorize(name: string, user: unknown, ...args: unknown[]): Promise<void> {
    const response = await this.resolveAbility(name, user, ...args)
    if (!response.allowed) {
      throw new ForbiddenException(response.message ?? 'Authorization failed')
    }
  }

  // Policies

  /**
   * Register a policy class under a resource name.
   * @param {string} resource - The resource name (e.g. 'post', 'user')
   * @param {new () => BasePolicy} PolicyClass - The policy class constructor
   * @returns {this} The Authorize instance for chaining
   *
   * @example
   * ```ts
   * auth.registerPolicy('post', PostPolicy)
   * ```
   */
  registerPolicy(resource: string, PolicyClass: new () => BasePolicy): this {
    this.policies.set(resource, PolicyClass)
    // Invalidate cache if re-registering
    this.policyProxyCache.delete(resource)
    return this
  }

  /**
   * Retrieve a PolicyProxy for the given resource.
   *
   * The wrapped policy instance is cached and shared across all requests, so
   * policies MUST be stateless — never store per-request data (the current
   * user, request-scoped fields, etc.) on the policy instance, or it will leak
   * across requests. Pass everything a policy needs as method arguments.
   *
   * @param {string} resource - The resource name
   * @returns {PolicyProxy} A proxy wrapping the (shared, stateless) policy instance
   * @throws {Error} If no policy is registered for the resource
   *
   * @example
   * ```ts
   * const canEdit = await auth.policy('post').allows('edit', user, post)
   * ```
   */
  policy(resource: string): PolicyProxy {
    if (this.policyProxyCache.has(resource)) {
      return this.policyProxyCache.get(resource) as PolicyProxy
    }

    const PolicyClass = this.policies.get(resource)
    if (!PolicyClass) {
      throw new Error(`No policy registered for resource "${resource}"`)
    }

    const proxy = new PolicyProxy(new PolicyClass(), this)
    this.policyProxyCache.set(resource, proxy)
    return proxy
  }
}
