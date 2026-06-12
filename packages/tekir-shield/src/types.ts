// Generic context/middleware types (tekir-agnostic shim)

export interface ShieldContext {
  request: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body?: Record<string, unknown>;
    query?: Record<string, string | string[] | undefined>;
  };
  response: {
    headers: Record<string, string>;
    setHeader(name: string, value: string): void;
  };
  session?: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  /** Abort the request with an HTTP error */
  throw(status: number, message: string): never;
}

export type MiddlewareFn = (
  ctx: ShieldContext,
  next: () => Promise<void>
) => Promise<void>;

// CSRF types

export interface CsrfOptions {
  /**
   * HMAC secret used to sign CSRF tokens. When set, the session stores only a
   * random value and the emitted token is `<random>.<hmac>`, so a token forged
   * against a leaked/shared session store fails verification without the
   * secret. When omitted, the raw random value is compared directly.
   */
  secret?: string;
  /** Session key under which the CSRF token is stored. Default: `_csrfToken` */
  sessionKey?: string;
  /**
   * List of URL path prefixes that are exempt from CSRF validation.
   * Useful for API routes that use Bearer-token auth instead of cookies.
   * Example: ['/api/', '/webhooks/']
   */
  exceptPaths?: string[];
  /**
   * HTTP methods that require CSRF validation.
   * Default: POST, PUT, PATCH, DELETE
   */
  protectedMethods?: string[];
  /**
   * Rotate (regenerate) the stored token after each successfully validated
   * mutating request, making accepted tokens single-use. Default: false.
   */
  rotateOnUse?: boolean;
}

// CSP types

export type CspDirectives = {
  [directive: string]: string[] | boolean;
};

export interface CspOptions {
  /** CSP directives keyed by camelCase name or raw kebab-case name. */
  directives?: CspDirectives;
  /**
   * Use `Content-Security-Policy-Report-Only` instead of
   * `Content-Security-Policy`.  Default: false.
   */
  reportOnly?: boolean;
}

// Helmet types

// `ALLOW-FROM` is unsupported by modern browsers and only permits a single
// origin; use CSP `frame-ancestors` for per-origin framing control instead.
export type XFrameOption = "DENY" | "SAMEORIGIN";

export interface HstsOptions {
  /** Max age in seconds. Default: 15552000 (180 days). */
  maxAge?: number;
  /** Include subdomains. Default: true. */
  includeSubDomains?: boolean;
  /** Add preload directive. Default: false. */
  preload?: boolean;
}

export interface HelmetOptions {
  /**
   * `X-Content-Type-Options`.
   * Set to `false` to disable.  Default: `"nosniff"`.
   */
  contentTypeOptions?: "nosniff" | false;

  /**
   * `X-Frame-Options`.
   * Set to `false` to disable.  Default: `"SAMEORIGIN"`.
   */
  frameOptions?: XFrameOption | false;

  /**
   * `X-XSS-Protection`.
   * Set to `false` to disable.  Default: `"0"` (modern browsers should
   * rely on CSP instead).
   */
  xssProtection?: string | false;

  /**
   * `Strict-Transport-Security` (HSTS).
   * Set to `false` to disable.
   */
  hsts?: HstsOptions | false;

  /**
   * `X-Download-Options`.
   * Set to `false` to disable.  Default: `"noopen"`.
   */
  downloadOptions?: "noopen" | false;

  /**
   * `X-Permitted-Cross-Domain-Policies`.
   * Set to `false` to disable.  Default: `"none"`.
   */
  permittedCrossDomainPolicies?:
    | "none"
    | "master-only"
    | "by-content-type"
    | "all"
    | false;

  /**
   * `Referrer-Policy`.
   * Set to `false` to disable.  Default: `"no-referrer"`.
   */
  referrerPolicy?:
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url"
    | false;

  /**
   * `Cross-Origin-Opener-Policy`.
   * Set to `false` to disable.  Default: `false` (opt-in).
   */
  crossOriginOpenerPolicy?:
    | "unsafe-none"
    | "same-origin-allow-popups"
    | "same-origin"
    | false;

  /**
   * `Cross-Origin-Embedder-Policy`.
   * Set to `false` to disable.  Default: `false` (opt-in).
   */
  crossOriginEmbedderPolicy?: "unsafe-none" | "require-corp" | false;

  /**
   * `Cross-Origin-Resource-Policy`.
   * Set to `false` to disable.  Default: `false` (opt-in).
   */
  crossOriginResourcePolicy?: "same-site" | "same-origin" | "cross-origin" | false;
}

// Rate-limit types

export interface RateLimitInfo {
  /** Total requests allowed in the window. */
  limit: number;
  /** Remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets. */
  reset: number;
  /** Optional: retry-after seconds (used when limit is exceeded). */
  retryAfter?: number;
}

// Shield composer types

export interface ShieldOptions {
  csrf?: CsrfOptions | false;
  helmet?: HelmetOptions | false;
  csp?: CspOptions | false;
}
