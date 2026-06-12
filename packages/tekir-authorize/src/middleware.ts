import { getApp } from '@tekir/core'
import type { MiddlewareFunction } from '@tekir/core'
import { ForbiddenException } from './types'
import type { Authorize } from './authorize'

/** Resolves the per-request resource args for an ability check from the ctx. */
export type AbilityArgResolver = (ctx: any) => unknown[] | Promise<unknown[]>

/**
 * Authorization middleware factory. Creates middleware that checks the given ability
 * for the authenticated user. Throws ForbiddenException if unauthenticated or unauthorized.
 *
 * Pass static args, or a resolver function that derives the resource from the
 * request at call time. The resolver form is what enables ownership/IDOR
 * checks: load the `:id` resource from ctx and hand it to the ability so the
 * gate can compare it against the user, instead of being limited to role-only
 * checks frozen at route-definition time.
 *
 * @param {string} ability - The ability name to check
 * @param {...unknown} args - Static args, OR a single resolver `(ctx) => args[]`
 * @returns {(ctx: AuthContext, next: () => Promise<void>) => Promise<void>} Middleware function
 *
 * @example
 * ```ts
 * // Role-only (static):
 * router.post('/posts', can('create-post'), handler)
 *
 * // Ownership/IDOR-safe (lazy resolver loads the resource from the request):
 * router.put('/posts/:id', can('edit-post', (ctx) => [ctx.loadedPost]), handler)
 * ```
 */
export function can(ability: string, ...args: unknown[] | [AbilityArgResolver]): MiddlewareFunction {
  const resolver = args.length === 1 && typeof args[0] === 'function'
    ? (args[0] as AbilityArgResolver)
    : null

  return async (ctx, next) => {
    const auth = (ctx as { auth?: { user?: unknown; isAuthenticated?: boolean } })?.auth
    const user = auth?.user
    // A populated `user` is not enough — a half-built auth state can carry a
    // user object while `isAuthenticated` is false. Require an explicitly
    // authenticated session before running any ability check.
    if (!user || auth?.isAuthenticated === false) {
      throw new ForbiddenException('Unauthenticated')
    }
    const resolvedArgs = resolver ? await resolver(ctx) : (args as unknown[])
    const authorize = getApp().use('authorize') as Authorize
    await authorize.authorize(ability, user, ...resolvedArgs)
    await next()
  }
}
