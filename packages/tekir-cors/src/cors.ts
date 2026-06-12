import type { CorsConfig } from './types'

const defaults: CorsConfig = {
  enabled: true,
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  credentials: false,
  maxAge: 86400,
}

/**
 * CORS middleware that handles preflight OPTIONS requests and sets Access-Control headers.
 * Supports wildcard, array, string, and function-based origin validation.
 * When `credentials: true` with `origin: true`, reflects the request origin instead of using `*`.
 *
 * Headers are written to `ctx.$responseHeaders` so the framework merges them
 * onto the outgoing response right before it goes on the wire, regardless of
 * which middleware built the response or where in the chain CORS sits.
 *
 * @param userConfig - CORS configuration options.
 * @param userConfig.origin - Allowed origins: `true` (all), `false` (none), `string`, `string[]`, or `(origin) => boolean`.
 * @param userConfig.methods - Allowed HTTP methods. Defaults to `['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']`.
 * @param userConfig.credentials - Allow credentials (cookies, auth headers). Defaults to `false`.
 * @param userConfig.maxAge - Preflight cache duration in seconds. Defaults to `86400` (24h).
 * @param userConfig.headers - Allowed request headers: `true` (reflect), or `string[]`.
 * @param userConfig.exposeHeaders - Headers exposed to the browser.
 *
 * @example
 * ```ts
 * // Allow all origins
 * app.use(cors())
 *
 * // Allow specific origins with credentials
 * app.use(cors({
 *   origin: ['https://app.com', 'https://admin.app.com'],
 *   credentials: true,
 * }))
 *
 * // Dynamic origin validation
 * app.use(cors({
 *   origin: (origin) => origin.endsWith('.myapp.com'),
 * }))
 * ```
 */
export function cors(userConfig: CorsConfig = {}) {
  const cfg = { ...defaults, ...userConfig }

  // Reflecting an arbitrary Origin with `Access-Control-Allow-Credentials: true`
  // hands any site credentialed access to this origin's responses. Refuse the
  // dangerous `origin: true` + `credentials: true` combination at construction
  // time and require an explicit allowlist (string/array/function) instead.
  if (cfg.credentials && cfg.origin === true) {
    throw new Error(
      '@tekir/cors: `credentials: true` cannot be combined with `origin: true`. ' +
      'Reflecting every Origin with credentials enabled lets any site read authenticated responses. ' +
      'Provide an explicit allowlist (string, string[], or a validator function).'
    )
  }

  return async (ctx: any, next: () => Promise<void>) => {
    if (!cfg.enabled) return next()

    const origin = ctx.request.header('origin') || ctx.headers?.origin || ''

    let allowOrigin = ''
    if (cfg.origin === true) {
      // No credentials here (the credentials+true combo is rejected above), so
      // the wildcard is safe. Reflect the request origin when present, else `*`.
      allowOrigin = origin || '*'
    } else if (cfg.origin === false) {
      allowOrigin = ''
    } else if (typeof cfg.origin === 'string') {
      allowOrigin = cfg.origin
    } else if (Array.isArray(cfg.origin)) {
      // RFC 6454 origins are compared exactly (case-sensitive scheme/host).
      allowOrigin = cfg.origin.includes(origin) ? origin : ''
    } else if (typeof cfg.origin === 'function') {
      allowOrigin = cfg.origin(origin) ? origin : ''
    }

    // A `null` origin (sandboxed iframes, data:/file: schemes) must never be
    // trusted with credentials — it is not bound to any real site.
    if (cfg.credentials && allowOrigin === 'null') return next()

    if (!allowOrigin) return next()

    // Stash the negotiated CORS headers on ctx so the framework merges them
    // onto whatever response goes out. Writing here (instead of mutating
    // `ctx.$result` after `next()`) makes CORS ordering-independent: it
    // works whether `cors()` sits before or after error handlers and slots
    // headers onto framework-handled 404s and 500s alike.
    const headers: Headers = (ctx.$responseHeaders ??= new Headers())
    headers.set('Access-Control-Allow-Origin', allowOrigin)
    if (cfg.credentials) headers.set('Access-Control-Allow-Credentials', 'true')
    if (cfg.exposeHeaders?.length) headers.set('Access-Control-Expose-Headers', cfg.exposeHeaders.join(', '))
    // Vary: Origin keeps caches honest when the allow-origin is request-derived.
    const existingVary = headers.get('Vary')
    if (!existingVary) {
      headers.set('Vary', 'Origin')
    } else if (!existingVary.split(',').map(s => s.trim().toLowerCase()).includes('origin')) {
      headers.set('Vary', `${existingVary}, Origin`)
    }

    const method = ctx.request?.method || ctx.request?.raw?.method || ''
    if (method === 'OPTIONS') {
      // Skip empty header values: an empty Allow-Methods/Allow-Headers silently
      // breaks the preflight instead of leaving the browser's defaults in place.
      if (cfg.methods?.length) headers.set('Access-Control-Allow-Methods', cfg.methods.join(', '))

      let allowHeaders = ''
      if (cfg.headers === true) {
        // `headers: true` reflects the requested headers. With credentials we
        // must echo the explicit list (a `*` is invalid for credentialed
        // requests and would fail the preflight), never a wildcard.
        const requested = ctx.request.header('access-control-request-headers') || ''
        allowHeaders = cfg.credentials ? requested : (requested || '*')
      } else if (Array.isArray(cfg.headers)) {
        allowHeaders = cfg.headers.join(', ')
      }
      if (allowHeaders) headers.set('Access-Control-Allow-Headers', allowHeaders)

      if (cfg.maxAge) headers.set('Access-Control-Max-Age', String(cfg.maxAge))
      // Short-circuit the chain. Framework merges $responseHeaders onto this
      // bare 204, so the preflight response carries all the negotiated bits.
      return new Response(null, { status: 204 })
    }

    await next()
  }
}
