/**
 * HTTP Context — the base interface passed to all handlers and middleware.
 *
 * Packages extend this via `declare module '@tekir/core'`:
 * - `@tekir/auth` adds `auth` (user, isAuthenticated, guard, logout)
 * - `@tekir/bodyparser` adds `file()`, `allFiles()`
 * - `@tekir/core/server-timing` adds `timing`
 *
 * This keeps the base interface minimal. Only install what you use.
 */
export interface HttpContext {
  request: TekirRequest
  response: TekirResponse
  params: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string>
  cookies: { get(name: string): string | null | undefined }
  body: Record<string, unknown>
  /**
   * Error thrown while parsing the request body, if any. Set when the
   * declared `Content-Type` did not match the actual payload (empty body
   * with `application/json`, malformed urlencoded, etc.). Routes can read
   * this and respond with a real 400 instead of crashing.
   */
  bodyError?: Error
  /**
   * Headers that the framework merges onto the outgoing response right
   * before it is returned, regardless of which middleware built the
   * response. Middleware that needs to attach response headers (CORS,
   * Server-Timing, request id) should write here instead of mutating
   * `ctx.$result`, so the headers land on success, error, and
   * framework-handled-error paths alike, independent of middleware
   * ordering.
   */
  $responseHeaders?: Headers
  route: {
    pattern: string
    name?: string
  }
  /** Dynamic subdomain params (e.g. { tenant: 'acme' } for ':tenant.example.com') */
  subdomains: Record<string, string>
  // After-middleware result
  $result: unknown
  // Utilities
  redirect: (url: string, status?: number) => Response
  status: (code: number, body?: unknown) => Response
  store: Record<string, unknown>
  server?: unknown
  // Open for package augmentation
  [key: string]: unknown
}

export type MiddlewareFunction = (ctx: HttpContext, next: () => Promise<void>) => void | Response | Promise<void | Response>

export type RouteHandler = (ctx: HttpContext) => any

export interface SSEEvent {
  event?: string
  data: any
  id?: string
  retry?: number | string
}

export interface TekirRequest {
  raw: Request
  url: string
  method: string
  path: string
  host: string
  hostname: string
  protocol: string
  origin: string
  ip: string
  ips: string[]
  completeUrl: string

  header(name: string, defaultValue?: string): string | undefined
  headers(): Record<string, string>
  all(): any
  input(key: string, defaultValue?: any): any
  only(keys: string[]): Record<string, any>
  except(keys: string[]): Record<string, any>
  qs(): Record<string, string | string[]>
  param(key: string, defaultValue?: string): string | undefined
  params(): Record<string, string>
  hasBody(): boolean
  accepts(types: string[]): string | false
  language(languages: string[]): string | null
  languages(): string[]
  is(types: string[]): boolean
  cookie(name: string): string | null
  signedCookie(name: string, secret: string): string | null
  cookies(): { get(name: string): string | null | undefined }
  id(): string
  matchesRoute(name: string): boolean
}

/**
 * Callable redirect helper. Acts as a function for the common case
 * (`response.redirect('/path')`) and exposes `.back()` for "go back where
 * the user came from" navigations.
 */
export interface TekirRedirect {
  (url: string, status?: number): Response
  /**
   * Redirect to the page the request came from (the `Referer` header).
   * Same-origin only — cross-origin referers are ignored to prevent open
   * redirects. When the referer is missing or cross-origin, redirects to
   * `fallback` (defaults to `/`).
   */
  back(fallback?: string): Response
}

export interface TekirResponse {
  // Core
  status(code: number): TekirResponse
  json(data?: any): Response
  send(data?: any): Response
  html(data: string): Response
  text(data: string): Response
  redirect: TekirRedirect
  stream(readable: ReadableStream): Response
  download(filePath: string): Response | Promise<Response>
  attachment(filePath: string, filename?: string): Response | Promise<Response>
  sse(data: SSEEvent | string): string
  getStatusCode(): number

  // Headers
  header(name: string, value: string): TekirResponse
  safeHeader(name: string, value: string): TekirResponse
  append(name: string, value: string): TekirResponse
  removeHeader(name: string): TekirResponse

  // Cookies
  cookie(name: string, value: string, options?: CookieOptions): TekirResponse
  signedCookie(name: string, value: string, secret: string, options?: CookieOptions): TekirResponse
  encryptedCookie(name: string, value: string, secret: string, options?: CookieOptions): TekirResponse
  clearCookie(name: string): TekirResponse
  onFinish(callback: () => void): TekirResponse

  // 2xx Success
  ok(data?: any): Response                        // 200
  created(data?: any): Response                    // 201
  accepted(data?: any): Response                   // 202
  noContent(): Response                            // 204

  // 3xx Redirection
  movedPermanently(url: string): Response          // 301
  found(url: string): Response                     // 302
  seeOther(url: string): Response                  // 303
  notModified(): Response                          // 304
  temporaryRedirect(url: string): Response         // 307
  permanentRedirect(url: string): Response         // 308

  // 4xx Client Error
  badRequest(data?: any): Response                 // 400
  unauthorized(data?: any): Response               // 401
  paymentRequired(data?: any): Response            // 402
  forbidden(data?: any): Response                  // 403
  notFound(data?: any): Response                   // 404
  methodNotAllowed(data?: any): Response           // 405
  notAcceptable(data?: any): Response              // 406
  requestTimeout(data?: any): Response             // 408
  conflict(data?: any): Response                   // 409
  gone(data?: any): Response                       // 410
  preconditionFailed(data?: any): Response         // 412
  payloadTooLarge(data?: any): Response            // 413
  unsupportedMediaType(data?: any): Response       // 415
  unprocessableEntity(data?: any): Response        // 422
  tooManyRequests(data?: any): Response            // 429

  // 5xx Server Error
  internalServerError(data?: any): Response        // 500
  notImplemented(data?: any): Response             // 501
  badGateway(data?: any): Response                 // 502
  serviceUnavailable(data?: any): Response         // 503
  gatewayTimeout(data?: any): Response             // 504
}

export interface TekirUploadedFile {
  fieldName: string
  clientName: string
  size: number
  type: string
  subtype: string
  extname: string
  errors: Array<{ field: string; rule: string; message: string }>
  hasErrors: boolean
  isValid: boolean
  filePath: string | null
  fileName: string | null
  toBuffer(): Buffer
  toString(encoding?: string): string
  toStream(): ReadableStream
  move(directory: string, name?: string): Promise<void>
  moveToDisk(directory: string, options?: { disk?: string; name?: string }): Promise<string>
  delete(): Promise<void>
}

export interface CookieOptions {
  path?: string
  domain?: string
  maxAge?: number
  expires?: Date
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
}

export type BodyParserType = 'json' | 'text' | 'formdata' | 'urlencoded' | 'none'

export interface BodyParserConfig {
  enabled?: boolean
  maxSize?: number // bytes
  allowedTypes?: BodyParserType[]
}

export type LifecycleHook = (ctx: HttpContext) => any

export interface ServerOptions {
  port?: number
  hostname?: string
  development?: boolean
  bodyParser?: BodyParserConfig
  /**
   * Idle timeout in seconds for the underlying HTTP server. A connection
   * that exchanges no traffic for this long is closed by the runtime.
   *
   * Defaults to `120` (two minutes), which is comfortably above typical
   * SSE keepalive intervals (15-30 s) and long-poll cycles, while still
   * reaping stuck or slowloris-style connections. Pass `0` to disable
   * the timeout entirely for apps that hold genuinely long-lived idle
   * connections, or any other value (Bun.serve clamps to 0..255).
   */
  idleTimeout?: number
  /**
   * Hostnames the app trusts for same-origin checks (e.g.
   * `redirect.back()`'s Referer validation). The client-controlled `Host`
   * header is spoofable on a directly-exposed deployment, so when this list
   * is set, same-origin logic compares the Referer host against it instead
   * of the request's `Host`.
   *
   * Entries are matched case-insensitively against the Referer host (with or
   * without port). A leading `*.` denotes a wildcard subdomain match, e.g.
   * `*.example.com` matches `api.example.com` but not `example.com` itself
   * (add `example.com` separately to allow the apex).
   *
   * When empty/unset, the framework keeps the previous behavior: it trusts
   * the request `Host` header and, since `back()` only ever reuses the
   * Referer's `pathname + search`, a spoofed Host can at most bounce the
   * user to a local path they could already reach.
   */
  trustedHosts?: string[]
}
