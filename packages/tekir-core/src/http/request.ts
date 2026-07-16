import type { TekirRequest } from './types'
import { verifySignedCookieValue } from './response'

type RequestWithCookies = Request & { cookies?: { get(name: string): string | undefined | null } }

/**
 * Return the runtime cookie map when available, otherwise parse the standard
 * Cookie header. The fallback keeps request helpers working on Node and on
 * plain Web API Request instances where Bun's `request.cookies` extension is
 * not present.
 */
export function getRequestCookies(raw: Request): { get(name: string): string | undefined | null } {
  const runtimeCookies = (raw as RequestWithCookies).cookies
  if (runtimeCookies && typeof runtimeCookies.get === 'function') return runtimeCookies

  const parsed = new Map<string, string>()
  const header = raw.headers.get('cookie')
  if (!header) return parsed

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    const name = part.slice(0, separator).trim()
    if (!name || parsed.has(name)) continue
    const value = part.slice(separator + 1).trim()
    try {
      parsed.set(name, decodeURIComponent(value))
    } catch {
      parsed.set(name, value)
    }
  }
  return parsed
}

export function getRequestCookie(raw: Request, name: string): string | null {
  return getRequestCookies(raw).get(name) ?? null
}

/** Keys that would walk into `Object.prototype` if copied onto a plain object. */
function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype'
}

/**
 * Merge sources into a fresh null-prototype object, skipping prototype-pollution
 * keys. Used by `all()`/`only()`/`except()` so their output can never carry a
 * `__proto__`/`constructor` gadget downstream.
 */
function safeMerge(...sources: any[]): Record<string, any> {
  const out: Record<string, any> = Object.create(null)
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue
    for (const key of Object.keys(src)) {
      if (isUnsafeKey(key)) continue
      out[key] = src[key]
    }
  }
  return out
}

/**
 * Create a TekirRequest wrapper around a raw Request with parsed params, body, and query string.
 * @param raw - The original Web API Request object.
 * @param params - Route parameters extracted from the URL pattern.
 * @param parsedBody - Pre-parsed request body (if any).
 * @param routeName - The matched route's name (if named).
 * @returns A TekirRequest with helper methods for accessing input, headers, and cookies.
 */
export function createRequest(
  raw: Request,
  params: Record<string, string>,
  parsedBody?: any,
  routeName?: string,
  parsedQuery?: Record<string, string | string[]>
): TekirRequest {
  let parsedUrl: URL | undefined
  let queryParams = parsedQuery
  let requestId: string | undefined
  const body: any = parsedBody

  // URL and query parsing are lazy. A hot route that only reads
  // `request.method` or `request.url` keeps the same allocation profile as
  // the former compiler-specific request object, while every TekirRequest
  // method remains available when a handler delegates the request elsewhere.
  const getUrl = () => (parsedUrl ??= new URL(raw.url))
  const getQuery = (): Record<string, string | string[]> => {
    if (queryParams) return queryParams
    const result: Record<string, string | string[]> = Object.create(null)
    queryParams = result
    for (const [key, value] of getUrl().searchParams.entries()) {
      if (isUnsafeKey(key)) continue
      const existing = result[key]
      if (existing !== undefined) {
        result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
      } else {
        result[key] = value
      }
    }
    return result
  }

  const request: TekirRequest = {
    raw,
    url: raw.url,
    method: (raw as any)._spoofedMethod || raw.method,
    get path() { return getUrl().pathname },
    get host() { return getUrl().host },
    get hostname() { return getUrl().hostname },
    get protocol() { return getUrl().protocol },
    get origin() { return getUrl().origin },
    get completeUrl() { return raw.url },
    ip: '',
    ips: [],

    header(name: string, defaultValue?: string) {
      return raw.headers.get(name.toLowerCase()) ?? defaultValue
    },

    headers() {
      // Use forEach instead of .entries() — the latter requires the
      // `DOM.Iterable` lib, which not every consumer tsconfig pulls in.
      const out: Record<string, string> = {}
      raw.headers.forEach((value, key) => { out[key] = value })
      return out
    },

    all() {
      return safeMerge(getQuery(), body)
    },

    input(key: string, defaultValue?: any) {
      if (isUnsafeKey(key)) return defaultValue
      if (body && Object.prototype.hasOwnProperty.call(body, key)) return body[key]
      const query = getQuery()
      if (Object.prototype.hasOwnProperty.call(query, key)) return query[key]
      if (Object.prototype.hasOwnProperty.call(params, key)) return params[key]
      return defaultValue
    },

    only(keys: string[]) {
      const all = request.all()
      const result: Record<string, any> = Object.create(null)
      for (const key of keys) if (!isUnsafeKey(key) && key in all) result[key] = all[key]
      return result
    },

    except(keys: string[]) {
      const all = request.all()
      const result: Record<string, any> = Object.create(null)
      for (const key in all) if (!keys.includes(key)) result[key] = all[key]
      return result
    },

    qs() { return getQuery() },
    param(key: string, defaultValue?: string) { return params[key] ?? defaultValue },
    params() { return params },
    hasBody() { return body !== undefined && body !== null },

    accepts(types: string[]) {
      const accept = raw.headers.get('accept') || ''
      for (const type of types) if (accept.includes(type)) return type
      return false
    },

    language(languages: string[]) {
      const acceptLang = raw.headers.get('accept-language') || ''
      for (const lang of languages) {
        if (acceptLang.includes(lang)) return lang
      }
      return null
    },

    languages() {
      const acceptLang = raw.headers.get('accept-language') || ''
      return acceptLang.split(',').map(l => l.split(';')[0].trim()).filter(Boolean)
    },

    is(types: string[]) {
      const contentType = raw.headers.get('content-type') || ''
      return types.some((t) => contentType.includes(t))
    },

    cookie(name: string) {
      return getRequestCookie(raw, name)
    },

    signedCookie(name: string, secret: string) {
      const raw_val = getRequestCookie(raw, name)
      if (!raw_val) return null
      // Delegate to the single canonical verifier (base64url decode +
      // constant-time compare) so cookies signed by `response.signedCookie`
      // round-trip correctly. The two implementations previously disagreed:
      // this side compared raw strings, the response side decoded base64url.
      const value = verifySignedCookieValue(raw_val, secret)
      if (value === null) return null
      return value
    },

    cookies() {
      return getRequestCookies(raw)
    },

    id() { return (requestId ??= raw.headers.get('x-request-id') || crypto.randomUUID()) },

    matchesRoute(name: string) {
      return routeName === name
    },
  }

  return request
}
