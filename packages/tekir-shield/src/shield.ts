import type { MiddlewareFn, ShieldOptions } from './types'
import { helmet } from './helmet'
import { csp } from './csp'
import { csrf } from './csrf'

// Convenience composer

/**
 * Convenience factory that composes `helmet`, `csrf`, and `csp` into a single
 * middleware array ready to be spread into your router's global middleware.
 *
 * @example
 * router.useGlobal(shield({
 *   csrf: { secret: env.APP_KEY, exceptPaths: ['/api/'] },
 *   helmet: { hsts: { maxAge: 31536000, preload: true } },
 *   csp: { directives: { defaultSrc: ["'self'"] } },
 * }))
 */
export function shield(options: ShieldOptions = {}): MiddlewareFn[] {
  const middlewares: MiddlewareFn[] = []

  if (options.helmet !== false) {
    middlewares.push(
      helmet(options.helmet === undefined ? {} : options.helmet)
    )
  }

  // Secure-by-default: apply a sensible CSP unless the caller explicitly opts
  // out with `csp: false`. Previously an omitted `csp` left the composer with
  // no CSP at all, silently shipping production without one.
  if (options.csp !== false) {
    middlewares.push(csp(options.csp === undefined ? {} : options.csp))
  }

  if (options.csrf !== false) {
    middlewares.push(
      csrf(options.csrf === undefined ? {} : options.csrf)
    )
  }

  return middlewares
}
