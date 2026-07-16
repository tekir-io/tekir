import type { SessionConfig } from './types'
import { MemorySessionStore } from './stores/memory'
import { Session } from './session'


/**
 * Session middleware that reads/writes session data via cookies and a configurable store.
 * Attaches a `Session` object to `ctx.session` with get/put/flash/regenerate methods.
 *
 * @param config - Session configuration options.
 * @param config.store - Storage backend (`MemorySessionStore`, `DatabaseSessionStore`, or custom). Defaults to in-memory.
 * @param config.age - Session TTL in seconds. Defaults to `7200` (2 hours).
 * @param config.cookieName - Cookie name. Defaults to `'tekir_session'`.
 * @param config.cookie - Cookie options (`httpOnly`, `secure`, `sameSite`, `path`).
 * @returns Middleware function that attaches `ctx.session` to the request context.
 *
 * @example
 * ```ts
 * import { session } from '@tekir/session'
 * import { DatabaseSessionStore } from '@tekir/session/stores/database'
 *
 * app.use(session({
 *   store: new DatabaseSessionStore(db),
 *   age: 3600,
 *   cookieName: 'my_app_session',
 *   cookie: { secure: true, sameSite: 'strict' },
 * }))
 *
 * // In a route handler:
 * ctx.session.put('user_id', user.id)
 * const userId = ctx.session.get('user_id')
 * ctx.session.flash('message', 'Welcome!')
 * ```
 */
export function session(config: SessionConfig = {}): (ctx: any, next: () => Promise<void>) => Promise<void> {
  const store = config.store || new MemorySessionStore()
  const ttl = config.age ?? 7200
  const cookieName = config.cookieName || 'tekir_session'
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('[@tekir/session] `age` must be a positive number of seconds')
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookieName)) throw new Error('[@tekir/session] Invalid cookie name')
  // Secure-by-default: HttpOnly, SameSite=Lax and Secure are all on unless a
  // caller explicitly opts out. `secure` defaults to true outside of an
  // explicit non-production environment so cookies are never sent in clear
  // text in real deployments.
  const isProd = (globalThis as any)?.process?.env?.NODE_ENV === 'production'
  const secureDefault = (globalThis as any)?.process?.env?.NODE_ENV === undefined ? true : isProd
  const cookieOpts = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: secureDefault,
    ...config.cookie,
  }
  for (const [name, value] of [['path', cookieOpts.path], ['domain', cookieOpts.domain]] as const) {
    if (value !== undefined && /[\r\n;]/.test(value)) {
      throw new Error(`[@tekir/session] Invalid cookie ${name}`)
    }
  }
  if (cookieOpts.sameSite === 'none' && !cookieOpts.secure) {
    throw new Error('[@tekir/session] SameSite=None cookies must also be Secure')
  }

  return async (ctx: any, next: () => Promise<void>) => {
    // Read session ID from cookie
    let sessionId = ctx.request?.cookie?.(cookieName) || ctx.cookies?.get?.(cookieName) || null

    if (!sessionId) {
      // Try raw cookie header — parse without regex to avoid ReDoS
      const raw = ctx.request?.header?.('cookie') || ctx.headers?.cookie || ''
      for (const pair of raw.split(';')) {
        const [key, ...rest] = pair.split('=')
        if (key?.trim() === cookieName) {
          sessionId = rest.join('=').trim()
          break
        }
      }
    }

    const incomingId = sessionId
    if (!sessionId) sessionId = crypto.randomUUID()

    // Load session data
    const data = await store.read(sessionId)
    const sess = new Session(sessionId, store, ttl, data ?? undefined)

    // Attach to context
    ctx.session = sess

    await next()

    // Save session after response. When nothing was written but the session
    // already existed, slide the store TTL so it stays in sync with the
    // re-sent cookie Max-Age (otherwise the store entry can expire while the
    // browser still presents a live cookie).
    const wrote = await sess.save()
    if (!wrote && incomingId && sess.id === incomingId && data) {
      await store.touch(sess.id, ttl)
    }

    // Build Set-Cookie header
    const parts = [`${cookieName}=${sess.id}`]
    parts.push(`Path=${cookieOpts.path}`)
    if (cookieOpts.domain) parts.push(`Domain=${cookieOpts.domain}`)
    parts.push(`Max-Age=${ttl}`)
    if (cookieOpts.httpOnly) parts.push('HttpOnly')
    if (cookieOpts.sameSite) parts.push(`SameSite=${cookieOpts.sameSite}`)
    if (cookieOpts.secure) parts.push('Secure')
    const setCookie = parts.join('; ')

    // The cookie MUST reach the client whenever the id is new or has changed
    // (e.g. after regenerate() on login). Track whether we actually managed
    // to emit it so a silently-lost cookie does not leave the user on a stale
    // or missing session id.
    const idChanged = sess.id !== incomingId
    let emitted = false

    // Inject cookie into the response object.
    const result = ctx.$result
    if (result instanceof Response) {
      result.headers.append('Set-Cookie', setCookie)
      emitted = true
    }

    // Framework response helper, if present.
    if (ctx.response?.cookie) {
      ctx.response.cookie(cookieName, sess.id, { ...cookieOpts, maxAge: ttl })
      emitted = true
    }

    // Header collection some adapters expose for accumulating Set-Cookie.
    if (!emitted && ctx.response?.headers?.append) {
      ctx.response.headers.append('Set-Cookie', setCookie)
      emitted = true
    }

    // Last resort: stash on the context so an outer adapter can flush it.
    // This guarantees the cookie is never silently dropped — critical when the
    // id changed (e.g. after regenerate() on login), since losing that cookie
    // would strand the user on a stale/missing session id.
    if (!emitted && typeof ctx === 'object') {
      ctx.$setCookies = ctx.$setCookies || []
      ctx.$setCookies.push(setCookie)
      emitted = true
    }

    // If the id changed but there was genuinely no sink at all, surface it
    // loudly rather than letting the regenerated id vanish.
    if (!emitted && idChanged) {
      throw new Error(
        '[@tekir/session] Unable to emit Set-Cookie for a regenerated session id; ' +
        'no Response, ctx.response.cookie, or header sink was available.',
      )
    }
  }
}

/** Alias for `session()` — creates session middleware with the given config. */
export function createSession(config?: SessionConfig) {
  return session(config)
}
