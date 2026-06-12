import { UnauthorizedException } from '@tekir/core'
import type { AuthGuard, AuthUser, TokenVerifier } from '../types'

/** Configuration for the access token (Bearer) auth guard. */
export interface AccessTokenGuardConfig {
  headerName?: string
  prefix?: string
}

/** Auth guard that validates Bearer tokens from the Authorization header using a custom verifier. */
export class AccessTokenGuard<T extends AuthUser = AuthUser> implements AuthGuard<T> {
  name = 'access_token'

  constructor(
    private verifier: TokenVerifier<T>,
    private config: AccessTokenGuardConfig = {}
  ) {}

  /**
   * Extracts and verifies a Bearer token from the request's Authorization header.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns The authenticated user resolved by the token verifier.
   * @example
   * const user = await guard.authenticate(ctx)
   */
  async authenticate(ctx: any): Promise<T> {
    const headerName = this.config.headerName || 'authorization'
    const prefix = this.config.prefix || 'Bearer'

    const header = ctx.request?.header?.(headerName) || ctx.headers?.[headerName] || ''
    if (!header) throw new UnauthorizedException('Missing authorization header')

    const prefixStr = `${prefix} `
    const token = header.startsWith(prefixStr) ? header.slice(prefixStr.length) : header
    if (!token) throw new UnauthorizedException('Empty token')

    const user = await this.verifier(token)
    if (!user) throw new UnauthorizedException('Invalid or expired token')

    return user
  }

  /**
   * Checks whether the request contains a valid Bearer token without throwing.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns `true` if authentication succeeds, `false` otherwise.
   * @example
   * if (await guard.check(ctx)) { ... }
   */
  async check(ctx: any): Promise<boolean> {
    try { await this.authenticate(ctx); return true } catch { return false }
  }
}
