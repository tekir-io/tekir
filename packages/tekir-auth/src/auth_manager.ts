import type { AuthConfig, AuthGuard } from './types'
import { buildAuthState, emptyAuthState } from './middleware'

/**
 * Central auth manager that holds guard configuration and provides
 * login, logout, and middleware helpers for request authentication.
 */
export class Auth {
  public config: AuthConfig

  constructor(config: AuthConfig) {
    this.config = config
  }

  /**
   * Resolves and returns a guard instance by name, falling back to the default guard.
   *
   * @param name - The guard name to resolve. Uses `defaultGuard` if omitted.
   * @returns The instantiated guard.
   * @example
   * const jwt = auth.guard<JwtGuard>('jwt')
   */
  guard<T extends AuthGuard = AuthGuard>(name?: string): T {
    const guardName = name || this.config.defaultGuard
    const factory = this.config.guards[guardName]
    if (!factory) throw new Error(`Auth guard "${guardName}" not configured`)
    return factory() as T
  }

  /**
   * Logs a user in using the specified guard and sets `ctx.auth`.
   *
   * @param ctx - The HTTP context.
   * @param user - The user to authenticate.
   * @param guardName - Optional guard name; defaults to the configured default.
   */
  async login(ctx: any, user: any, guardName?: string): Promise<void> {
    const name = guardName || this.config.defaultGuard
    const guard = this.guard(name)
    if (guard.login) await guard.login(user, ctx)
    ctx.auth = buildAuthState(user, name, guard, ctx)
  }

  /**
   * Logs the current user out and resets `ctx.auth` to an empty state.
   *
   * @param ctx - The HTTP context.
   * @param guardName - Optional guard name; defaults to the configured default.
   */
  async logout(ctx: any, guardName?: string): Promise<void> {
    const guard = this.guard(guardName)
    if (guard.logout) await guard.logout(ctx)
    ctx.auth = emptyAuthState(ctx)
  }

  /**
   * Returns middleware that authenticates the request using one or more guards.
   * Responds with 401 if all guards fail.
   *
   * @param guardNames - Guard name(s) to try, in order. Defaults to the configured default.
   * @returns A middleware function.
   * @example
   * router.use(auth.middleware(['jwt', 'session']))
   */
  middleware(guardNames?: string | string[]) {
    const guards = guardNames
      ? Array.isArray(guardNames) ? guardNames : [guardNames]
      : [this.config.defaultGuard]

    return async (ctx: any, next: () => Promise<void>) => {
      let lastError: Error | null = null
      let authenticated = false

      for (const guardName of guards) {
        const guard = this.guard(guardName)
        try {
          const user = await guard.authenticate(ctx)
          ctx.auth = buildAuthState(user, guardName, guard, ctx)
          authenticated = true
          break
        } catch (error: any) {
          lastError = error
        }
      }

      if (authenticated) {
        await next()
        return
      }

      // Generic message to the client; detail stays in the log to avoid user
      // enumeration via differing error strings.
      if (lastError) {
        console.warn('[auth] authentication failed:', lastError.message)
      }
      const res = new Response(
        JSON.stringify({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED', statusCode: 401 } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
      ctx.$result = res
      return res
    }
  }

  /**
   * Returns middleware that attempts authentication silently.
   * Sets `ctx.auth` if successful but always calls `next()` regardless of outcome.
   *
   * @param guardNames - Guard name(s) to try. Defaults to the configured default.
   * @returns A middleware function.
   */
  silentAuth(guardNames?: string | string[]) {
    const guards = guardNames
      ? Array.isArray(guardNames) ? guardNames : [guardNames]
      : [this.config.defaultGuard]

    return async (ctx: any, next: () => Promise<void>) => {
      ctx.auth = emptyAuthState(ctx)

      for (const guardName of guards) {
        const guard = this.guard(guardName)
        try {
          const user = await guard.authenticate(ctx)
          ctx.auth = buildAuthState(user, guardName, guard, ctx)
          break
        } catch {}
      }

      await next()
    }
  }

  /**
   * Returns middleware that only allows unauthenticated (guest) requests.
   * Responds with 403 if the user is already authenticated.
   *
   * @param guardName - The guard to check against.
   * @returns A middleware function.
   */
  guest(guardName?: string) {
    return async (ctx: any, next: () => Promise<void>) => {
      const guard = this.guard(guardName)
      const isAuth = guard.check ? await guard.check(ctx) : false
      if (isAuth) {
        return new Response('{"message":"Already authenticated"}', {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      await next()
    }
  }
}
