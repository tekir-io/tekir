import { UnauthorizedException } from '@tekir/core'
import type { AuthGuard, AuthUser, JwtGuardConfig, JwtPayload } from '../types'
import { resolveAuthSubject } from '../resolve_auth'

/**
 * Auth guard that authenticates users via signed JWT tokens (HMAC-SHA256).
 * Supports token generation with configurable default and maximum expiry.
 *
 * @example
 * ```ts
 * const jwt = new JwtGuard({
 *   secret: process.env.APP_KEY,
 *   expiresIn: 3600,        // default: 1 hour
 *   maxExpiresIn: 86400,    // cap: 1 day
 *   resolve: (id) => User.find(id),
 * })
 *
 * // Generate token
 * const { token, expiresAt } = await jwt.generate(user)
 *
 * // Authenticate request
 * const user = await jwt.authenticate(ctx) // reads Authorization: Bearer <token>
 * ```
 */
export class JwtGuard<T extends AuthUser = AuthUser> implements AuthGuard<T> {
  name = 'jwt'
  private secret: string
  private expiresIn: number
  private maxExpiresIn: number
  private resolve: (id: string | number) => Promise<AuthUser | null>

  constructor(config: JwtGuardConfig) {
    this.secret = config.secret
    this.expiresIn = config.expiresIn || 3600
    this.maxExpiresIn = config.maxExpiresIn ?? 604800 // 7 days default
    this.resolve = resolveAuthSubject('JwtGuard', config)
  }

  /**
   * Extracts a JWT from the Authorization header, verifies its HMAC-SHA256
   * signature and expiry, then resolves the user via `resolve`.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns The authenticated user.
   * @example
   * const user = await jwt.authenticate(ctx)
   */
  async authenticate(ctx: any): Promise<T> {
    const header = ctx.request?.header?.('authorization') || ctx.headers?.authorization || ''
    if (!header) throw new UnauthorizedException('Missing authorization header')

    const token = header.startsWith('Bearer ') ? header.slice(7) : header
    if (!token) throw new UnauthorizedException('Missing token')

    const payload = await this.verify(token)
    const user = await this.resolve(payload.sub)
    if (!user) throw new UnauthorizedException('User not found')

    return user as T
  }

  /**
   * Signs a new JWT for the given user with optional custom claims and expiry.
   * The expiry is capped at `maxExpiresIn`.
   *
   * @param user - The user to encode as the token subject.
   * @param options - Optional overrides for expiry and extra JWT claims.
   * @returns An object containing the signed `token` string and its `expiresAt` date.
   * @example
   * const { token, expiresAt } = await jwt.generate(user, { expiresIn: 7200 })
   */
  async generate(user: T, options?: { expiresIn?: number; claims?: Record<string, any> }): Promise<{ token: string; expiresAt: Date }> {
    const now = Math.floor(Date.now() / 1000)
    const requestedExpiry = options?.expiresIn || this.expiresIn
    const exp = now + Math.min(requestedExpiry, this.maxExpiresIn)

    // Spread custom claims first, then write the registered claims, so
    // callers cannot accidentally (or deliberately) override `sub`, `iat`,
    // or `exp` through `options.claims`. A token whose `sub` does not
    // match the user passed in would be a silent identity-spoofing
    // footgun; reject it loudly.
    if (options?.claims) {
      for (const reserved of ['sub', 'iat', 'exp']) {
        if (reserved in options.claims) {
          throw new Error(`JWT claim "${reserved}" is reserved and cannot be overridden via options.claims`)
        }
      }
    }
    const payload: JwtPayload = {
      ...options?.claims,
      sub: user.id,
      iat: now,
      exp,
    }

    const token = await this.sign(payload)
    return { token, expiresAt: new Date(exp * 1000) }
  }

  /**
   * Checks whether the request carries a valid JWT without throwing.
   *
   * @param ctx - The HTTP context containing request headers.
   * @returns `true` if the JWT is valid, `false` otherwise.
   */
  async check(ctx: any): Promise<boolean> {
    try { await this.authenticate(ctx); return true } catch { return false }
  }

  // JWT sign using Web Crypto API (works in Bun)
  private async sign(payload: JwtPayload): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' }
    const encodedHeader = base64url(JSON.stringify(header))
    const encodedPayload = base64url(JSON.stringify(payload))
    const data = `${encodedHeader}.${encodedPayload}`

    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
    const encodedSignature = base64url(signature)

    return `${data}.${encodedSignature}`
  }

  // JWT verify
  private async verify(token: string): Promise<JwtPayload> {
    const parts = token.split('.')
    if (parts.length !== 3) throw new UnauthorizedException('Invalid token format')

    const [header, payload, signature] = parts
    const data = `${header}.${payload}`

    // Validate the JOSE header BEFORE verifying the signature. Pinning the
    // expected algorithm rejects `alg: none` and HS/RS algorithm-confusion
    // attacks where an attacker swaps the header to coerce the verifier.
    let decodedHeader: { alg?: unknown; typ?: unknown }
    try {
      decodedHeader = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/')))
    } catch {
      throw new UnauthorizedException('Invalid token header')
    }
    if (decodedHeader.alg !== 'HS256') {
      throw new UnauthorizedException('Unexpected token algorithm')
    }
    if (decodedHeader.typ !== undefined && decodedHeader.typ !== 'JWT') {
      throw new UnauthorizedException('Unexpected token type')
    }

    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )

    const sigBuffer = base64urlDecode(signature)
    const valid = await crypto.subtle.verify('HMAC', key, sigBuffer, new TextEncoder().encode(data))
    if (!valid) throw new UnauthorizedException('Invalid token signature')

    let decoded: JwtPayload
    try {
      decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as JwtPayload
    } catch {
      throw new UnauthorizedException('Invalid token payload')
    }

    // A token without a usable `exp` would never expire — treat a missing or
    // malformed expiry as invalid rather than immortal.
    if (typeof decoded.exp !== 'number' || !Number.isFinite(decoded.exp)) {
      throw new UnauthorizedException('Token has no valid expiry')
    }
    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expired')
    }

    // Reject not-yet-valid tokens when `nbf` is present.
    if (decoded.nbf !== undefined) {
      if (typeof decoded.nbf !== 'number' || !Number.isFinite(decoded.nbf)) {
        throw new UnauthorizedException('Invalid token nbf claim')
      }
      if (decoded.nbf > Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException('Token not yet valid')
      }
    }

    // Without a subject the resolver would be handed `undefined` and could
    // silently resolve the wrong user — require it.
    if (decoded.sub === undefined || decoded.sub === null || decoded.sub === '') {
      throw new UnauthorizedException('Token missing subject')
    }

    return decoded
  }
}

function base64url(data: string | ArrayBuffer): string {
  const str = typeof data === 'string'
    ? btoa(data)
    : btoa(String.fromCharCode(...new Uint8Array(data)))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - str.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

