import { UnauthorizedException } from '@tekir/core'
import type { AuthGuard, AuthUser, BasicAuthGuardConfig } from '../types'

/** Auth guard that authenticates users via HTTP Basic Authentication (username:password). */
export class BasicAuthGuard<T extends AuthUser = AuthUser> implements AuthGuard<T> {
  name = 'basic'

  constructor(private config: BasicAuthGuardConfig) {}

  /**
   * Decodes the Base64-encoded Basic credentials from the Authorization header
   * and verifies them against the configured credential verifier.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns The authenticated user.
   * @example
   * const user = await guard.authenticate(ctx)
   */
  async authenticate(ctx: any): Promise<T> {
    const header = ctx.request?.header?.('authorization') || ctx.headers?.authorization || ''
    if (!header || !header.startsWith('Basic ')) {
      throw new UnauthorizedException('Missing basic auth credentials')
    }

    const decoded = atob(header.slice(6))
    const colonIndex = decoded.indexOf(':')
    if (colonIndex === -1) throw new UnauthorizedException('Invalid basic auth format')

    const uid = decoded.slice(0, colonIndex)
    const password = decoded.slice(colonIndex + 1)

    const user = await this.config.verifyCredentials(uid, password)
    if (!user) throw new UnauthorizedException('Invalid credentials')

    return user as T
  }

  /**
   * Checks whether the request contains valid Basic credentials without throwing.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns `true` if authentication succeeds, `false` otherwise.
   */
  async check(ctx: any): Promise<boolean> {
    try { await this.authenticate(ctx); return true } catch { return false }
  }
}
