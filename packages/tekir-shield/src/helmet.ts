import type { ShieldContext, MiddlewareFn, HelmetOptions, HstsOptions } from './types'

// Defaults

const HELMET_DEFAULTS: Required<HelmetOptions> = {
  contentTypeOptions: "nosniff",
  frameOptions: "SAMEORIGIN",
  xssProtection: "0",
  hsts: {
    maxAge: 15552000, // 180 days
    includeSubDomains: true,
    // preload is a near-irreversible commitment (every subdomain must be
    // HTTPS, removal takes months). Leave it opt-in.
    preload: false,
  },
  downloadOptions: "noopen",
  permittedCrossDomainPolicies: "none",
  referrerPolicy: "no-referrer",
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}

// Internal helpers

/** Build the HSTS header value string. */
function buildHstsValue(opts: HstsOptions): string {
  const maxAge = opts.maxAge ?? 15552000
  let value = `max-age=${maxAge}`
  if (opts.includeSubDomains !== false) value += "; includeSubDomains"
  if (opts.preload) value += "; preload"
  return value
}

// Public API

/**
 * Helmet-style security headers middleware.
 *
 * Applies a collection of well-known HTTP security headers with sensible
 * defaults.  Every header can be individually configured or disabled by
 * passing `false`.
 *
 * @example
 * helmet()
 * helmet({ frameOptions: "DENY", hsts: { maxAge: 31536000, preload: true } })
 * helmet({ hsts: false }) // disable HSTS (e.g. during local dev)
 */
export function helmet(options: HelmetOptions = {}): MiddlewareFn {
  const opts: Required<HelmetOptions> = {
    ...HELMET_DEFAULTS,
    ...options,
    // Deep-merge hsts if both sides are objects.
    hsts:
      options.hsts === false
        ? false
        : typeof options.hsts === "object"
        ? { ...(HELMET_DEFAULTS.hsts as HstsOptions), ...options.hsts }
        : HELMET_DEFAULTS.hsts,
  }

  // Pre-compute the list of headers to set so the middleware closure is cheap.
  const headers: Array<[string, string]> = []

  if (opts.contentTypeOptions) {
    headers.push(["X-Content-Type-Options", opts.contentTypeOptions])
  }
  if (opts.frameOptions) {
    headers.push(["X-Frame-Options", opts.frameOptions])
  }
  if (opts.xssProtection !== false) {
    headers.push(["X-XSS-Protection", opts.xssProtection as string])
  }
  if (opts.hsts !== false) {
    headers.push([
      "Strict-Transport-Security",
      buildHstsValue(opts.hsts as HstsOptions),
    ])
  }
  if (opts.downloadOptions) {
    headers.push(["X-Download-Options", opts.downloadOptions])
  }
  if (opts.permittedCrossDomainPolicies) {
    headers.push([
      "X-Permitted-Cross-Domain-Policies",
      opts.permittedCrossDomainPolicies,
    ])
  }
  if (opts.referrerPolicy) {
    headers.push(["Referrer-Policy", opts.referrerPolicy])
  }
  if (opts.crossOriginOpenerPolicy) {
    headers.push(["Cross-Origin-Opener-Policy", opts.crossOriginOpenerPolicy])
  }
  if (opts.crossOriginEmbedderPolicy) {
    headers.push([
      "Cross-Origin-Embedder-Policy",
      opts.crossOriginEmbedderPolicy,
    ])
  }
  if (opts.crossOriginResourcePolicy) {
    headers.push([
      "Cross-Origin-Resource-Policy",
      opts.crossOriginResourcePolicy,
    ])
  }

  return async (ctx: ShieldContext, next: () => Promise<void>): Promise<void> => {
    for (const [name, value] of headers) {
      ctx.response.setHeader(name, value)
    }
    await next()
  }
}
