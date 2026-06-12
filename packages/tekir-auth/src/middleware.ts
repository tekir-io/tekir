import type { AuthGuard, AuthState } from './types'
import type { Auth } from './auth_manager'

/**
 * Mutate `ctx.auth` in place to reflect the given (user, guard) pair. Keeps
 * the same object reference so destructured handlers like
 * `({ auth }: HttpContext) => { await auth.login(user); auth.generate() }`
 * continue to work after a login swap.
 */
function applyAuthState(state: AuthState, user: any, guardName: string, guard: AuthGuard, ctx: any): AuthState {
  state.user = user
  state.isAuthenticated = true
  state.guard = guardName
  state.login = async (newUser: any, newGuardName?: string) => {
    const auth = getAuth()
    const name = newGuardName || guardName
    const g = auth.guard(name)
    if (g.login) await g.login(newUser, ctx)
    applyAuthState(state, newUser, name, g, ctx)
  }
  state.generate = async (options?: any) => {
    if (!guard.generate) throw new Error(`Guard "${guardName}" does not support generate()`)
    return guard.generate(user, options)
  }
  state.logout = async () => {
    if (guard.logout) await guard.logout(ctx)
    applyEmptyAuthState(state, ctx)
  }
  state.list = async () => {
    if (!(guard as any).list) throw new Error(`Guard "${guardName}" does not support list()`)
    return (guard as any).list(user.id)
  }
  state.revokeAll = async () => {
    if (!(guard as any).revokeAll) throw new Error(`Guard "${guardName}" does not support revokeAll()`)
    return (guard as any).revokeAll(user.id)
  }
  return state
}

/** Reset `state` to the unauthenticated shape (used on logout / silentAuth init). */
function applyEmptyAuthState(state: AuthState, ctx?: any): AuthState {
  state.user = null
  state.isAuthenticated = false
  state.guard = ''
  state.login = async (user: any, guardName?: string) => {
    const auth = getAuth()
    const name = guardName || auth.config.defaultGuard
    const guard = auth.guard(name)
    if (guard.login) await guard.login(user, ctx)
    applyAuthState(state, user, name, guard, ctx)
  }
  state.generate = () => Promise.reject(new Error('Not authenticated'))
  state.logout = () => Promise.resolve()
  state.list = () => Promise.reject(new Error('Not authenticated'))
  state.revokeAll = () => Promise.reject(new Error('Not authenticated'))
  return state
}

function buildAuthState(user: any, guardName: string, guard: AuthGuard, ctx: any): AuthState {
  return applyAuthState({} as AuthState, user, guardName, guard, ctx)
}

function emptyAuthState(ctx?: any): AuthState {
  return applyEmptyAuthState({} as AuthState, ctx)
}

function getAuth(): Auth {

  const { getApp } = require('@tekir/core')
  return getApp().use('auth')
}

function resolveGuards(guardNames?: string | string[]): string[] {
  if (!guardNames) return [getAuth()['config'].defaultGuard]
  return Array.isArray(guardNames) ? guardNames : [guardNames]
}

// Standalone middleware functions

/**
 * Standalone authentication middleware factory. Tries each guard in order and
 * sets `ctx.auth` on success, or returns a 401 JSON response if all guards fail.
 *
 * @param guardNames - Guard name(s) to attempt. Defaults to the configured default guard.
 * @returns A middleware function.
 * @example
 * router.use(authenticate('jwt'))
 */
export function authenticate(guardNames?: string | string[]) {
  return async (ctx: any, next: () => Promise<void>) => {
    const auth = getAuth()
    const guards = resolveGuards(guardNames)
    let lastError: Error | null = null
    let authenticated = false

    for (const guardName of guards) {
      const guard = auth.guard(guardName)
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

    // Return a single generic message to the client. Guard-specific reasons
    // ("User not found", "Token expired", ...) are an enumeration signal, so
    // keep them in the server log only.
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
 * Cheap middleware that attaches an unauthenticated `ctx.auth` to every
 * request without trying to verify a token. Use it globally so handlers can
 * always call `auth.login(...)` (e.g. in `/register`, `/login`) — token
 * verification still happens through `authenticate()` or `silentAuth()` on
 * the routes that actually need it.
 */
export function attachAuth() {
  return async (ctx: any, next: () => Promise<void>) => {
    if (!ctx.auth) ctx.auth = emptyAuthState(ctx)
    await next()
  }
}

/**
 * Standalone silent-auth middleware factory. Attempts authentication but always
 * continues to the next middleware regardless of success or failure.
 *
 * @param guardNames - Guard name(s) to attempt. Defaults to the configured default guard.
 * @returns A middleware function.
 */
export function silentAuth(guardNames?: string | string[]) {
  return async (ctx: any, next: () => Promise<void>) => {
    const auth = getAuth()
    const guards = resolveGuards(guardNames)
    ctx.auth = emptyAuthState(ctx)

    for (const guardName of guards) {
      const guard = auth.guard(guardName)
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
 * Standalone guest-only middleware factory. Blocks already-authenticated users
 * with a 403 response and allows unauthenticated requests through.
 *
 * @param guardName - The guard to check against. Defaults to the configured default guard.
 * @returns A middleware function.
 */
export function guest(guardName?: string) {
  return async (ctx: any, next: () => Promise<void>) => {
    const auth = getAuth()
    const guard = auth.guard(guardName)
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

export { buildAuthState, emptyAuthState }
