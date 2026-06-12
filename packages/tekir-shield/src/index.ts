/**
 * @tekir/shield — Security middleware package
 *
 * Provides:
 *  - CSRF protection
 *  - Content Security Policy (CSP)
 *  - Security headers (Helmet-style)
 *  - XSS sanitization helpers
 *  - Rate-limit headers helper
 */

export type {
  ShieldContext,
  MiddlewareFn,
  CsrfOptions,
  CspDirectives,
  CspOptions,
  XFrameOption,
  HstsOptions,
  HelmetOptions,
  RateLimitInfo,
  ShieldOptions,
} from './types'

export { csrfToken, rotateCsrfToken, csrf } from './csrf'
export { helmet } from './helmet'
export { CspPresets, buildCspHeader, csp } from './csp'
export { sanitize, escapeHtml, unescapeHtml } from './sanitize'
export { setRateLimitHeaders, rateLimitHeaders } from './rate_limit_headers'
export { shield } from './shield'
