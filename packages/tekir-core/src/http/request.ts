import type { TekirRequest } from './types'
import { verifySignedCookieValue } from './response'

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
  routeName?: string
): TekirRequest {
  const url = new URL(raw.url)
  // Null-prototype map + reject pollution keys so `?__proto__[x]=y` style query
  // strings cannot reach `Object.prototype` through `all()`/`input()`/spread.
  const queryParams: Record<string, string | string[]> = Object.create(null)

  for (const [key, value] of url.searchParams.entries()) {
    if (isUnsafeKey(key)) continue
    const existing = queryParams[key]
    if (existing) {
      queryParams[key] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      queryParams[key] = value
    }
  }

  const requestId = raw.headers.get('x-request-id') || crypto.randomUUID()
  const body: any = parsedBody

  const request: TekirRequest = {
    raw,
    url: raw.url,
    method: raw.method,
    path: url.pathname,
    hostname: url.hostname,
    protocol: url.protocol.replace(':', ''),
    completeUrl: raw.url,
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
      return safeMerge(queryParams, body)
    },

    input(key: string, defaultValue?: any) {
      if (isUnsafeKey(key)) return defaultValue
      if (body && Object.prototype.hasOwnProperty.call(body, key)) return body[key]
      if (Object.prototype.hasOwnProperty.call(queryParams, key)) return queryParams[key]
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

    qs() { return queryParams },
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
      return (raw as any).cookies?.get(name) ?? null
    },

    signedCookie(name: string, secret: string) {
      const raw_val = (raw as any).cookies?.get(name)
      if (!raw_val) return null
      // Delegate to the single canonical verifier (base64url decode +
      // constant-time compare) so cookies signed by `response.signedCookie`
      // round-trip correctly. The two implementations previously disagreed:
      // this side compared raw strings, the response side decoded base64url.
      const value = verifySignedCookieValue(raw_val, secret)
      if (value === null) return null
      return decodeURIComponent(value)
    },

    cookies() {
      return (raw as any).cookies
    },

    id() { return requestId },

    matchesRoute(name: string) {
      return routeName === name
    },
  }

  return request
}
