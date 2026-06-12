import { createHmac } from 'node:crypto'
import type { ShieldContext, MiddlewareFn, CsrfOptions } from './types'

// Utilities (internal)

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {

    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/** Generate a cryptographically random hex token of `byteLength` bytes. */
function randomToken(byteLength = 32): string {
  const buf = new Uint8Array(byteLength)
  crypto.getRandomValues(buf)
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Signed-token format (only used when `secret` is provided):
//   <random>.<hmac-sha256(random, secret)>
// The random half is what we persist in the session; the HMAC half makes the
// emitted token tamper-evident, so a token forged against a leaked/shared
// session store still fails verification without the server secret.

/** HMAC-sign the session-stored random value with the configured secret. */
function signToken(raw: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(raw).digest('hex')
  return `${raw}.${sig}`
}

/** Recompute the signature and constant-time compare it against `token`. */
function verifySignedToken(token: string, raw: string, secret: string): boolean {
  const dot = token.indexOf('.')
  if (dot === -1) return false
  return safeEqual(token, signToken(raw, secret))
}

// Defaults

const CSRF_DEFAULTS: Required<Omit<CsrfOptions, "secret">> = {
  sessionKey: "_csrfToken",
  exceptPaths: [],
  protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
  rotateOnUse: false,
}

// Public API

/**
 * Retrieve (or lazily create) the CSRF token stored in the session.
 *
 * When a `secret` is provided the session stores only a random value and the
 * returned token is HMAC-signed (`<random>.<hmac>`), making it tamper-evident.
 * Without a secret the raw random value is both stored and returned.
 *
 * @param ctx - The shield context with an attached `session`.
 * @param sessionKey - Session key for the token. Defaults to `'_csrfToken'`.
 * @param secret - Optional HMAC secret to sign the emitted token.
 * @returns The CSRF token string (signed when `secret` is given).
 * @example
 * // In a template:
 * <input type="hidden" name="_csrf" value={csrfToken(ctx)} />
 */
export function csrfToken(
  ctx: ShieldContext,
  sessionKey = CSRF_DEFAULTS.sessionKey,
  secret?: string
): string {
  if (!ctx.session) {
    throw new Error(
      "@tekir/shield csrf: ctx.session is not available. " +
        "Make sure the session middleware runs before csrf()."
    )
  }

  let raw = ctx.session.get(sessionKey) as string | undefined
  if (!raw) {
    raw = randomToken(32)
    ctx.session.set(sessionKey, raw)
  }
  return secret ? signToken(raw, secret) : raw
}

/**
 * Rotate the CSRF token, discarding the old session value and issuing a fresh
 * one. Call this on any authentication-state change (login/logout) to defeat
 * session-fixation: a token captured before login can no longer be replayed.
 *
 * @param ctx - The shield context with an attached `session`.
 * @param sessionKey - Session key for the token. Defaults to `'_csrfToken'`.
 * @param secret - Optional HMAC secret to sign the emitted token.
 * @returns The newly issued CSRF token.
 */
export function rotateCsrfToken(
  ctx: ShieldContext,
  sessionKey = CSRF_DEFAULTS.sessionKey,
  secret?: string
): string {
  if (!ctx.session) {
    throw new Error(
      "@tekir/shield csrf: ctx.session is not available. " +
        "Make sure the session middleware runs before csrf()."
    )
  }
  const raw = randomToken(32)
  ctx.session.set(sessionKey, raw)
  return secret ? signToken(raw, secret) : raw
}

/**
 * CSRF protection middleware.
 *
 * - Skips safe methods (GET, HEAD, OPTIONS).
 * - Skips paths matching `exceptPaths` prefixes.
 * - Validates the incoming token against the session token.
 * - Token is read from (in priority order):
 *     1. `ctx.request.body._csrf`
 *     2. `ctx.request.headers['x-csrf-token']`
 *
 * @param options - CSRF configuration (session key, except paths, protected methods).
 * @returns A middleware function that enforces CSRF validation.
 */
export function csrf(options: CsrfOptions = {}): MiddlewareFn {
  const opts = { ...CSRF_DEFAULTS, ...options }
  const secret = options.secret

  return async (ctx: ShieldContext, next: () => Promise<void>): Promise<void> => {
    const method = ctx.request.method.toUpperCase()
    const url = ctx.request.url

    // Skip validation for non-mutating methods.
    if (!opts.protectedMethods.includes(method)) {
      await next()
      return
    }

    // Skip validation for excepted paths.
    const isExcepted = opts.exceptPaths.some((prefix) => url.startsWith(prefix))
    if (isExcepted) {
      await next()
      return
    }

    // Retrieve token from request body or header only (query string is insecure — URLs are logged/cached)
    const bodyToken =
      typeof ctx.request.body?._csrf === "string"
        ? (ctx.request.body._csrf as string)
        : undefined

    const headerToken = Array.isArray(ctx.request.headers["x-csrf-token"])
      ? ctx.request.headers["x-csrf-token"][0]
      : (ctx.request.headers["x-csrf-token"] as string | undefined)

    const incomingToken = bodyToken ?? headerToken

    if (!incomingToken) {
      ctx.throw(403, "CSRF token missing.")
    }

    // Read the stored random value directly. Do NOT lazily mint one here: a
    // request with no established session token must be rejected, not matched
    // against a freshly-created secret.
    const storedRaw = ctx.session?.get(opts.sessionKey) as string | undefined
    if (!storedRaw) {
      ctx.throw(403, "CSRF token invalid.")
    }

    const valid = secret
      ? verifySignedToken(incomingToken as string, storedRaw as string, secret)
      : safeEqual(incomingToken as string, storedRaw as string)

    if (!valid) {
      ctx.throw(403, "CSRF token invalid.")
    }

    // Optionally rotate the token after a successful mutating request so each
    // accepted token is single-use (defense in depth against token capture).
    if (opts.rotateOnUse) {
      rotateCsrfToken(ctx, opts.sessionKey, secret)
    }

    await next()
  }
}
