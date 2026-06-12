import { UnauthorizedException } from '@tekir/core'
import type { AuthGuard, AuthUser, SessionGuardConfig } from '../types'
import { resolveAuthSubject } from '../resolve_auth'

/**
 * Auth guard that authenticates users via server-side sessions.
 * Automatically regenerates session ID on login to prevent session fixation attacks.
 *
 * @example
 * ```ts
 * const guard = new SessionGuard({
 *   resolve: (id) => User.find(id),
 *   sessionKey: 'auth_user_id', // optional, defaults to 'auth_user_id'
 * })
 *
 * await guard.login(user, ctx)   // stores user ID in session
 * await guard.logout(ctx)        // clears session and regenerates ID
 * const user = await guard.authenticate(ctx) // retrieves user from session
 * ```
 */
export class SessionGuard<T extends AuthUser = AuthUser> implements AuthGuard<T> {
  name = 'session'
  private resolve: (id: string | number) => Promise<AuthUser | null>

  constructor(private config: SessionGuardConfig) {
    this.resolve = resolveAuthSubject('SessionGuard', config)
  }

  /**
   * Reads the user ID from the session and resolves the full user object.
   * Throws if the session is missing, no user ID is stored, or the user no longer exists.
   *
   * @param ctx - The HTTP context with an attached `session`.
   * @returns The authenticated user.
   * @example
   * const user = await guard.authenticate(ctx)
   */
  async authenticate(ctx: any): Promise<T> {
    const key = this.config.sessionKey || 'auth_user_id'
    const session = ctx.session

    if (!session) throw new UnauthorizedException('Session not available. Enable @tekir/session.')

    const userId = session.get(key)
    if (!userId) throw new UnauthorizedException('Not authenticated')

    const user = await this.resolve(userId)
    if (!user) {
      session.forget(key)
      throw new UnauthorizedException('User not found')
    }

    return user as T
  }

  /**
   * Logs a user in by storing their ID in the session.
   * Regenerates the session ID first to prevent session fixation attacks.
   *
   * @param user - The user to log in.
   * @param ctx - The HTTP context with an attached `session`.
   * @example
   * await guard.login(user, ctx)
   */
  async login(user: T, ctx: any): Promise<void> {
    const key = this.config.sessionKey || 'auth_user_id'
    const session = ctx.session

    if (!session) throw new UnauthorizedException('Session not available. Enable @tekir/session.')

    // Regenerate session ID to prevent fixation attacks
    if (typeof session.regenerate === 'function') {
      await session.regenerate()
    } else if (typeof session.destroy === 'function') {
      await session.destroy()
    }

    session.put(key, user.id)
  }

  /**
   * Logs the user out by removing their ID from the session and regenerating the session ID.
   *
   * @param ctx - The HTTP context with an attached `session`.
   * @example
   * await guard.logout(ctx)
   */
  async logout(ctx: any): Promise<void> {
    const key = this.config.sessionKey || 'auth_user_id'
    const session = ctx.session

    if (session) {
      session.forget(key)
      if (typeof session.regenerate === 'function') {
        await session.regenerate()
      }
    }
  }

  /**
   * Checks whether the session contains a valid authenticated user without throwing.
   *
   * @param ctx - The HTTP context with an attached `session`.
   * @returns `true` if the user is authenticated, `false` otherwise.
   */
  async check(ctx: any): Promise<boolean> {
    try {
      await this.authenticate(ctx)
      return true
    } catch {
      return false
    }
  }
}
