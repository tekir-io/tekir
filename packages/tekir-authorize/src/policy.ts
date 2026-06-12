import { AuthorizationResponse, ForbiddenException, normalizeResult } from './types'
import type { AbilityResult } from './types'

/**
 * Abstract base class for authorization policies. Subclasses define methods
 * corresponding to actions (e.g. view, edit, delete) that receive (user, resource).
 *
 * @example
 * ```ts
 * class PostPolicy extends BasePolicy {
 *   edit(user: User, post: Post) {
 *     return user.id === post.authorId
 *   }
 * }
 * ```
 */
export abstract class BasePolicy {
  // Subclasses declare methods like:
  //   view(user: unknown, resource: unknown): AbilityResult { ... }
  //   edit(user: unknown, resource: unknown): AbilityResult { ... }
  [method: string]: unknown
}

// Minimal interface needed from Authorize to avoid circular import

interface AuthorizeForProxy {
  runBeforeHooks(user: unknown, ability: string, ...args: unknown[]): Promise<AbilityResult>
}

/**
 * Wraps a BasePolicy instance and exposes allows/denies/authorize methods
 * that respect global before-hooks.
 *
 * @example
 * ```ts
 * const proxy = auth.policy('post')
 * const canEdit = await proxy.allows('edit', user, post)
 * await proxy.authorize('delete', user, post) // throws if denied
 * ```
 */
export class PolicyProxy {
  private readonly policyInstance: BasePolicy
  private readonly manager: AuthorizeForProxy

  /**
   * @param {BasePolicy} policyInstance - The policy instance to wrap
   * @param {AuthorizeForProxy} manager - The Authorize manager (for before-hooks)
   */
  constructor(policyInstance: BasePolicy, manager: AuthorizeForProxy) {
    this.policyInstance = policyInstance
    this.manager = manager
  }

  // Resolve result from a policy method, respecting before-hooks
  private async resolvePolicy(method: string, user: unknown, ...args: unknown[]): Promise<AuthorizationResponse> {
    // Run global before-hooks first
    const beforeResult = await this.manager.runBeforeHooks(user, method, ...args)
    if (beforeResult !== undefined) {
      return normalizeResult(beforeResult)
    }

    const fn = this.policyInstance[method]
    if (typeof fn !== 'function') {
      return AuthorizationResponse.deny(`Policy method "${method}" is not defined`)
    }

    const raw = await fn.call(this.policyInstance, user, ...args)
    return normalizeResult(raw)
  }

  /**
   * Check if the policy method allows the action for the given user.
   * @param {string} method - The policy method name (e.g. 'edit', 'delete')
   * @param {unknown} user - The user to authorize
   * @param {...unknown} args - Additional arguments (e.g. the resource)
   * @returns {Promise<boolean>} True if allowed
   */
  async allows(method: string, user: unknown, ...args: unknown[]): Promise<boolean> {
    const response = await this.resolvePolicy(method, user, ...args)
    return response.allowed
  }

  /**
   * Check if the policy method denies the action for the given user.
   * @param {string} method - The policy method name
   * @param {unknown} user - The user to authorize
   * @param {...unknown} args - Additional arguments
   * @returns {Promise<boolean>} True if denied
   */
  async denies(method: string, user: unknown, ...args: unknown[]): Promise<boolean> {
    return !(await this.allows(method, user, ...args))
  }

  /**
   * Assert that the policy method allows the action. Throws ForbiddenException if denied.
   * @param {string} method - The policy method name
   * @param {unknown} user - The user to authorize
   * @param {...unknown} args - Additional arguments
   * @returns {Promise<void>}
   * @throws {ForbiddenException} If the action is denied
   */
  async authorize(method: string, user: unknown, ...args: unknown[]): Promise<void> {
    const response = await this.resolvePolicy(method, user, ...args)
    if (!response.allowed) {
      throw new ForbiddenException(response.message ?? 'Authorization failed')
    }
  }
}
