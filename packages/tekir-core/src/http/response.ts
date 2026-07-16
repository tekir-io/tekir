import type { TekirResponse, TekirRedirect, CookieOptions } from './types'
import { fileResponse as runtimeFileResponse } from '@tekir/runtime'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

interface ResponseBuilderState {
  finalize(response: Response): Response
}

const responseBuilderStates = new WeakMap<TekirResponse, ResponseBuilderState>()

/** Apply state staged on a Tekir response builder to an arbitrary result. */
export function finalizeResponse(builder: TekirResponse, outgoing: Response): Response {
  return responseBuilderStates.get(builder)?.finalize(outgoing) ?? outgoing
}

function hmacSign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

// App-configured trusted hosts for same-origin checks. Set once by
// `TekirServer.configure({ trustedHosts })` so the per-request `createResponse`
// calls in the compiled path inherit it without threading config through every
// call site. Empty means "not configured" → fall back to the Host header.
let _trustedHosts: string[] = []

/**
 * Register the hostnames the app trusts for same-origin checks (notably
 * `redirect.back()`). Called by the server when `trustedHosts` is configured.
 * Entries are lowercased; a leading `*.` marks a wildcard subdomain rule.
 */
export function setTrustedHosts(hosts: string[] | undefined): void {
  _trustedHosts = (hosts ?? []).map(h => h.trim().toLowerCase()).filter(Boolean)
}

/**
 * Whether `host` (a Referer's `URL.host`, possibly `name:port`) is trusted
 * against `trusted`. Compares both the full `host` and its bare hostname so a
 * configured `example.com` matches `example.com:8080`. A `*.example.com` rule
 * matches any single-or-deeper subdomain but not the apex.
 */
function isTrustedHost(host: string, trusted: string[]): boolean {
  const full = host.toLowerCase()
  const bare = full.split(':')[0]
  for (const rule of trusted) {
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1) // ".example.com"
      if (bare.endsWith(suffix) && bare.length > suffix.length) return true
    } else if (rule === full || rule === bare) {
      return true
    }
  }
  return false
}

/**
 * Derive a 32-byte AES key from a passphrase. Same secret → same key,
 * so a downstream `decryptCookieValue()` can recover the original
 * payload without separate key distribution. Use a stable secret (e.g.
 * `process.env.APP_KEY`) so the cookie survives process restarts.
 */
function deriveAesKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

/**
 * Encrypt a JSON-serializable value under `secret` and return a token
 * shaped `iv.ciphertext.authTag` (all base64url). Built on AES-256-GCM,
 * so callers get authenticated confidentiality (anyone tampering with
 * the cookie fails the auth-tag check on decrypt). Pair with
 * {@link decryptCookieValue} to read the value back on the request side.
 */
export function encryptCookieValue(value: unknown, secret: string): string {
  if (!secret) throw new Error('encryptCookieValue: secret is required')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveAesKey(secret), iv)
  const json = JSON.stringify(value)
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`
}

/**
 * Decrypt a value previously produced by {@link encryptCookieValue}.
 * Returns `null` when the cookie is malformed, the auth tag fails, or
 * the JSON payload cannot be parsed — callers should treat all three
 * the same way (the cookie is untrustworthy).
 */
export function decryptCookieValue<T = unknown>(token: string, secret: string): T | null {
  if (!token || !secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const iv = Buffer.from(parts[0], 'base64url')
    const ciphertext = Buffer.from(parts[1], 'base64url')
    const tag = Buffer.from(parts[2], 'base64url')
    if (iv.length !== 12 || tag.length !== 16) return null
    const decipher = createDecipheriv('aes-256-gcm', deriveAesKey(secret), iv)
    decipher.setAuthTag(tag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plain.toString('utf8')) as T
  } catch {
    return null
  }
}

/**
 * Verify a value produced by {@link TekirResponse.signedCookie}. Returns
 * the original (unsigned) value when the HMAC tag matches, or `null`
 * when the cookie was tampered with. Uses constant-time comparison.
 */
export function verifySignedCookieValue(token: string, secret: string): string | null {
  if (!token || !secret) return null
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const value = token.slice(0, dot)
  const provided = token.slice(dot + 1)
  let providedBuf: Buffer
  let expectedBuf: Buffer
  try {
    providedBuf = Buffer.from(provided, 'base64url')
    expectedBuf = Buffer.from(hmacSign(value, secret), 'base64url')
  } catch {
    return null
  }
  if (providedBuf.length !== expectedBuf.length) return null
  return timingSafeEqual(providedBuf, expectedBuf) ? value : null
}

/**
 * Create a new response builder with fluent API for HTTP responses.
 * Supports JSON, HTML, text, redirects, streams, downloads, SSE, signed/encrypted cookies,
 * and all standard HTTP status codes (2xx–5xx).
 *
 * @returns A `TekirResponse` instance with chainable methods.
 *
 * @example
 * ```ts
 * // JSON response
 * return ctx.response.ok({ users: [...] })
 *
 * // Redirect
 * return ctx.response.redirect('/dashboard')
 *
 * // Set cookie + return
 * ctx.response.cookie('token', 'abc', { httpOnly: true, secure: true })
 * return ctx.response.ok()
 *
 * // Signed cookie
 * ctx.response.signedCookie('session', 'data', process.env.APP_KEY)
 * ```
 */
export function createResponse(request?: Request, options?: { trustedHosts?: string[] }): TekirResponse {
  // Prefer an explicit per-call list; otherwise inherit the app-level set
  // registered via `setTrustedHosts` (compiled path uses `cr(request)` only).
  const trustedHosts = options?.trustedHosts
    ? options.trustedHosts.map(h => h.trim().toLowerCase()).filter(Boolean)
    : _trustedHosts
  let statusCode = 200
  let statusExplicit = false
  const headers = new Headers()
  const cookieJar: string[] = []
  const finishCallbacks: (() => void)[] = []
  const builtResponses = new WeakSet<Response>()
  let finishScheduled = false

  function scheduleFinish(): void {
    if (finishScheduled || finishCallbacks.length === 0) return
    finishScheduled = true
    queueMicrotask(() => {
      for (const callback of finishCallbacks) {
        try { callback() } catch {}
      }
    })
  }

  function snapshotHeaders(base?: Headers): Headers {
    const merged = new Headers(base)
    headers.forEach((value, key) => merged.set(key, value))
    for (const cookie of cookieJar) merged.append('Set-Cookie', cookie)
    return merged
  }

  function finalizeOutgoing(outgoing: Response): Response {
    if (builtResponses.has(outgoing)) {
      scheduleFinish()
      return outgoing
    }
    let hasStagedHeaders = false
    headers.forEach(() => { hasStagedHeaders = true })
    if (!statusExplicit && !hasStagedHeaders && cookieJar.length === 0) {
      scheduleFinish()
      return outgoing
    }
    const status = statusExplicit ? statusCode : outgoing.status
    const body = status === 204 || status === 205 || status === 304 ? null : outgoing.body
    const finalized = new Response(body, {
      status,
      statusText: outgoing.statusText,
      headers: snapshotHeaders(outgoing.headers),
    })
    builtResponses.add(finalized)
    scheduleFinish()
    return finalized
  }

  function own(response: Response): Response {
    builtResponses.add(response)
    scheduleFinish()
    return response
  }

  function buildResponse(data: any, contentType?: string): Response {
    if (data === null || data === undefined) {
      return own(new Response(null, { status: statusCode, headers: snapshotHeaders() }))
    }

    if (data instanceof Response) {
      return finalizeOutgoing(data)
    }

    if (data instanceof ReadableStream) {
      return own(new Response(data, { status: statusCode, headers: snapshotHeaders() }))
    }

    if (typeof data === 'object') {
      headers.set('Content-Type', contentType || 'application/json')
      return own(new Response(JSON.stringify(data), { status: statusCode, headers: snapshotHeaders() }))
    }

    if (typeof data === 'string') {
      const isHtml = data.trimStart().startsWith('<')
      headers.set('Content-Type', contentType || (isHtml ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'))
      return own(new Response(data, { status: statusCode, headers: snapshotHeaders() }))
    }

    headers.set('Content-Type', 'text/plain; charset=utf-8')
    return own(new Response(String(data), { status: statusCode, headers: snapshotHeaders() }))
  }

  function jsonResponse(data: any, status: number): Response {
    statusCode = status
    statusExplicit = true
    return buildResponse(data, 'application/json')
  }

  function redirectResponse(url: string, status: number): Response {
    statusCode = status
    statusExplicit = true
    headers.set('Location', url)
    return buildResponse(null)
  }

  /**
   * `runtimeFileResponse` builds a brand-new `Response` around `Bun.file()`,
   * so any headers callers staged via `headers.set(...)` (notably the
   * `Content-Disposition` for downloads) never reach the wire. Merge our
   * builder headers — plus queued `Set-Cookie` cookies — onto the file
   * response while preserving its body so streaming stays zero-copy.
   */
  function withResponseHeaders(fileResp: Response): Response {
    return finalizeOutgoing(fileResp)
  }

  // Callable redirect with `.back()` attached. `.back()` reads the request's
  // Referer header but only honors it when same-origin (otherwise an attacker
  // could craft an external referer to bounce the user off-site). When
  // `trustedHosts` is configured the Referer host is matched against that list
  // instead of the spoofable `Host` header; otherwise we fall back to the
  // `Host` header (legacy behavior, limited impact since only the Referer's
  // pathname + search is ever reused as the Location).
  const redirect = ((url: string, status = 302) => redirectResponse(url, status)) as TekirRedirect
  redirect.back = (fallback?: string) => {
    let location = fallback || '/'
    const referer = request?.headers.get('referer')
    if (referer) {
      try {
        const refUrl = new URL(referer)
        const sameOrigin = trustedHosts.length > 0
          ? isTrustedHost(refUrl.host, trustedHosts)
          : refUrl.host === request?.headers.get('host')
        if (sameOrigin) {
          location = refUrl.pathname + refUrl.search
        }
      } catch {}
    }
    return redirectResponse(location, 302)
  }

  const response: TekirResponse = {
    // Core
    status(code: number) { statusCode = code; statusExplicit = true; return response },
    json(data?: any) { return buildResponse(data, 'application/json') },
    send(data?: any) { return buildResponse(data) },
    html(data: string) { return buildResponse(data, 'text/html; charset=utf-8') },
    text(data: string) { return buildResponse(data, 'text/plain; charset=utf-8') },
    redirect,
    stream(readable: ReadableStream) { return buildResponse(readable) },
    async download(filePath: string) {
      const safeName = (filePath.split('/').pop() || 'download').replace(/["\\]/g, '_')
      headers.set('Content-Disposition', `attachment; filename="${safeName}"`)
      return withResponseHeaders(await runtimeFileResponse(filePath, statusCode))
    },
    async attachment(filePath: string, filename?: string) {
      const name = (filename || filePath.split('/').pop() || 'download').replace(/["\\]/g, '_')
      headers.set('Content-Disposition', `attachment; filename="${name}"`)
      return withResponseHeaders(await runtimeFileResponse(filePath, statusCode))
    },
    sse(data: any) {
      const stripNewlines = (v: string) => String(v).replace(/[\r\n]/g, '')
      if (typeof data === 'string') return `data: ${stripNewlines(data)}\n\n`
      let result = ''
      if (data.event) result += `event: ${stripNewlines(data.event)}\n`
      if (data.id) result += `id: ${stripNewlines(data.id)}\n`
      if (data.retry !== undefined) result += `retry: ${stripNewlines(String(data.retry))}\n`
      const payload = typeof data.data === 'object' ? JSON.stringify(data.data) : stripNewlines(String(data.data))
      result += `data: ${payload}\n\n`
      return result
    },
    getStatusCode() { return statusCode },

    // Headers
    header(name: string, value: string) { headers.set(name, value); return response },
    safeHeader(name: string, value: string) { if (!headers.has(name)) headers.set(name, value); return response },
    append(name: string, value: string) { headers.append(name, value); return response },
    removeHeader(name: string) { headers.delete(name); return response },

    // Cookies
    cookie(name: string, value: string, options: CookieOptions = {}) {
      const sanitize = (v: string) => String(v).replace(/[\r\n;]/g, '')
      let cookie = `${sanitize(name)}=${encodeURIComponent(value)}`
      if (options.path) cookie += `; Path=${sanitize(options.path)}`
      if (options.domain) cookie += `; Domain=${sanitize(options.domain)}`
      if (options.maxAge !== undefined) cookie += `; Max-Age=${Math.floor(Number(options.maxAge))}`
      if (options.expires) cookie += `; Expires=${options.expires.toUTCString()}`
      if (options.httpOnly) cookie += '; HttpOnly'
      if (options.secure) cookie += '; Secure'
      if (options.sameSite) cookie += `; SameSite=${sanitize(options.sameSite)}`
      cookieJar.push(cookie)
      return response
    },
    clearCookie(name: string) { cookieJar.push(`${String(name).replace(/[\r\n;]/g, '')}=; Max-Age=0; Path=/`); return response },

    signedCookie(name: string, value: string, secret: string, options: CookieOptions = {}) {
      const data = `${value}.${hmacSign(value, secret)}`
      return response.cookie(name, data, options)
    },

    encryptedCookie(name: string, value: string, secret: string, options: CookieOptions = {}) {
      // Real authenticated encryption (AES-256-GCM), unlike the legacy
      // base64+HMAC implementation. Pair with `decryptCookieValue()` on
      // the request side to read the original value back.
      return response.cookie(name, encryptCookieValue(value, secret), options)
    },

    onFinish(callback: () => void) {
      finishCallbacks.push(callback)
      return response
    },

    // 2xx Success
    ok(data?: any) { return jsonResponse(data, 200) },
    created(data?: any) { return jsonResponse(data, 201) },
    accepted(data?: any) { return jsonResponse(data, 202) },
    noContent() { statusCode = 204; statusExplicit = true; return buildResponse(null) },

    // 3xx Redirection
    movedPermanently(url: string) { return redirectResponse(url, 301) },
    found(url: string) { return redirectResponse(url, 302) },
    seeOther(url: string) { return redirectResponse(url, 303) },
    notModified() { statusCode = 304; statusExplicit = true; return buildResponse(null) },
    temporaryRedirect(url: string) { return redirectResponse(url, 307) },
    permanentRedirect(url: string) { return redirectResponse(url, 308) },

    // 4xx Client Error
    badRequest(data?: any) { return jsonResponse(data ?? { message: 'Bad Request' }, 400) },
    unauthorized(data?: any) { return jsonResponse(data ?? { message: 'Unauthorized' }, 401) },
    paymentRequired(data?: any) { return jsonResponse(data ?? { message: 'Payment Required' }, 402) },
    forbidden(data?: any) { return jsonResponse(data ?? { message: 'Forbidden' }, 403) },
    notFound(data?: any) { return jsonResponse(data ?? { message: 'Not Found' }, 404) },
    methodNotAllowed(data?: any) { return jsonResponse(data ?? { message: 'Method Not Allowed' }, 405) },
    notAcceptable(data?: any) { return jsonResponse(data ?? { message: 'Not Acceptable' }, 406) },
    requestTimeout(data?: any) { return jsonResponse(data ?? { message: 'Request Timeout' }, 408) },
    conflict(data?: any) { return jsonResponse(data ?? { message: 'Conflict' }, 409) },
    gone(data?: any) { return jsonResponse(data ?? { message: 'Gone' }, 410) },
    preconditionFailed(data?: any) { return jsonResponse(data ?? { message: 'Precondition Failed' }, 412) },
    payloadTooLarge(data?: any) { return jsonResponse(data ?? { message: 'Payload Too Large' }, 413) },
    unsupportedMediaType(data?: any) { return jsonResponse(data ?? { message: 'Unsupported Media Type' }, 415) },
    unprocessableEntity(data?: any) { return jsonResponse(data ?? { message: 'Unprocessable Entity' }, 422) },
    tooManyRequests(data?: any) { return jsonResponse(data ?? { message: 'Too Many Requests' }, 429) },

    // 5xx Server Error
    internalServerError(data?: any) { return jsonResponse(data ?? { message: 'Internal Server Error' }, 500) },
    notImplemented(data?: any) { return jsonResponse(data ?? { message: 'Not Implemented' }, 501) },
    badGateway(data?: any) { return jsonResponse(data ?? { message: 'Bad Gateway' }, 502) },
    serviceUnavailable(data?: any) { return jsonResponse(data ?? { message: 'Service Unavailable' }, 503) },
    gatewayTimeout(data?: any) { return jsonResponse(data ?? { message: 'Gateway Timeout' }, 504) },
  }

  responseBuilderStates.set(response, { finalize: finalizeOutgoing })

  return response
}
