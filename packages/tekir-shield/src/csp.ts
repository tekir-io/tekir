import type { ShieldContext, MiddlewareFn, CspOptions, CspDirectives } from './types'

// Internal maps

/** Maps directive names (camelCase) to their CSP attribute strings. */
const CSP_DIRECTIVE_MAP: Record<string, string> = {
  defaultSrc: "default-src",
  scriptSrc: "script-src",
  styleSrc: "style-src",
  imgSrc: "img-src",
  connectSrc: "connect-src",
  fontSrc: "font-src",
  objectSrc: "object-src",
  mediaSrc: "media-src",
  frameSrc: "frame-src",
  childSrc: "child-src",
  workerSrc: "worker-src",
  manifestSrc: "manifest-src",
  prefetchSrc: "prefetch-src",
  scriptSrcElem: "script-src-elem",
  scriptSrcAttr: "script-src-attr",
  styleSrcElem: "style-src-elem",
  styleSrcAttr: "style-src-attr",
  baseUri: "base-uri",
  formAction: "form-action",
  frameAncestors: "frame-ancestors",
  navigateTo: "navigate-to",
  reportUri: "report-uri",
  reportTo: "report-to",
  sandbox: "sandbox",
  upgradeInsecureRequests: "upgrade-insecure-requests",
  blockAllMixedContent: "block-all-mixed-content",
  requireTrustedTypesFor: "require-trusted-types-for",
  trustedTypes: "trusted-types",
}

// Public API

/** Common CSP source keyword presets. */
export const CspPresets = {
  self: "'self'",
  none: "'none'",
  unsafeInline: "'unsafe-inline'",
  unsafeEval: "'unsafe-eval'",
  strictDynamic: "'strict-dynamic'",
  unsafeHashes: "'unsafe-hashes'",
  data: "data:",
  blob: "blob:",
  https: "https:",
  http: "http:",
} as const

/** Build a CSP header value string from a directives map. */
export function buildCspHeader(directives: CspDirectives = {}): string {
  const parts: string[] = []

  for (const [key, value] of Object.entries(directives)) {
    // Resolve camelCase → kebab-case if known, otherwise use as-is.
    const attr = CSP_DIRECTIVE_MAP[key] ?? key

    if (value === false) continue // Explicitly disabled.

    if (value === true) {
      // Boolean directives (e.g. upgrade-insecure-requests).
      parts.push(attr)
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue
      parts.push(`${attr} ${value.join(" ")}`)
    }
  }

  return parts.join("; ")
}

/**
 * Content Security Policy middleware.
 *
 * @example
 * csp({
 *   directives: {
 *     defaultSrc: ["'self'"],
 *     scriptSrc: ["'self'", CspPresets.unsafeInline],
 *     upgradeInsecureRequests: true,
 *   },
 * })
 */
export function csp(options: CspOptions = {}): MiddlewareFn {
  const headerName = options.reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy"

  const defaultDirectives: CspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:"],
    fontSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  }
  const headerValue = buildCspHeader(options.directives ?? defaultDirectives)

  return async (ctx: ShieldContext, next: () => Promise<void>): Promise<void> => {
    if (headerValue) {
      ctx.response.setHeader(headerName, headerValue)
    }
    await next()
  }
}
