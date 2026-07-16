
export type { TestResponse, RequestOptions } from './types'
import type { TestResponse, RequestOptions } from './types'

/**
 * Order-independent structural deep equality. JSON.stringify comparison treats
 * `{a:1,b:2}` and `{b:2,a:1}` as different, producing false negatives in
 * assertions; this compares values regardless of key order.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return a === b
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const ka = Object.keys(a as Record<string, unknown>)
  const kb = Object.keys(b as Record<string, unknown>)
  if (ka.length !== kb.length) return false
  return ka.every(k =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  )
}

function createTestResponse(res: Response, rawBody: string, parsed: unknown): TestResponse {
  const tr: TestResponse = {
    status: res.status,
    headers: res.headers,
    body: parsed,
    text: rawBody,
    ok: res.ok,
    raw: res,

    assertStatus(code) {
      if (tr.status !== code) throw new Error(`Expected status ${code}, got ${tr.status}`)
      return tr
    },
    assertOk() { return tr.assertStatus(200) },
    assertCreated() { return tr.assertStatus(201) },
    assertNotFound() { return tr.assertStatus(404) },
    assertUnauthorized() { return tr.assertStatus(401) },
    assertForbidden() { return tr.assertStatus(403) },
    assertUnprocessable() { return tr.assertStatus(422) },
    assertRedirect(to?) {
      if (tr.status < 300 || tr.status >= 400) throw new Error(`Expected redirect, got ${tr.status}`)
      if (to && tr.headers.get('location') !== to) {
        throw new Error(`Expected redirect to ${to}, got ${tr.headers.get('location')}`)
      }
      return tr
    },
    assertJson(expected) {
      if (!deepEqual(tr.body, expected)) {
        throw new Error(`JSON mismatch:\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(tr.body)}`)
      }
      return tr
    },
    assertJsonContains(subset) {
      const body = tr.body as Record<string, unknown>
      for (const [key, value] of Object.entries(subset)) {
        if (!deepEqual(body?.[key], value)) {
          throw new Error(`Expected body.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(body?.[key])}`)
        }
      }
      return tr
    },
    assertJsonPath(path, value) {
      const parts = path.split('.')
      let current: unknown = tr.body
      for (const part of parts) {
        current = (current as Record<string, unknown>)?.[part]
      }
      if (!deepEqual(current, value)) {
        throw new Error(`Expected ${path} to be ${JSON.stringify(value)}, got ${JSON.stringify(current)}`)
      }
      return tr
    },
    assertHeader(name, value?) {
      const actual = tr.headers.get(name)
      if (!actual) throw new Error(`Expected header "${name}" to be present`)
      if (value !== undefined && actual !== value) {
        throw new Error(`Expected header "${name}" to be "${value}", got "${actual}"`)
      }
      return tr
    },
    assertHeaderMissing(name) {
      if (tr.headers.has(name)) throw new Error(`Expected header "${name}" to be missing`)
      return tr
    },
    assertCookie(name, value?) {
      const cookies = tr.headers.getSetCookie?.() || []
      const found = cookies.find((c: string) => c.startsWith(`${name}=`))
      if (!found) throw new Error(`Expected cookie "${name}" to be set`)
      if (value !== undefined) {
        const cookieVal = found.split('=')[1]?.split(';')[0]
        if (decodeURIComponent(cookieVal) !== value) {
          throw new Error(`Expected cookie "${name}" to be "${value}", got "${cookieVal}"`)
        }
      }
      return tr
    },
    assertBodyContains(text) {
      if (!rawBody.includes(text)) throw new Error(`Expected body to contain "${text}"`)
      return tr
    },
    assertError(expected) {
      const body = tr.body as Record<string, unknown>
      // tekir's HttpException.toJSON wraps in { error: { ... } } — unwrap when
      // present so callers don't have to remember which level they're on.
      const inner = (body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object')
        ? body.error as Record<string, unknown>
        : body
      for (const [key, value] of Object.entries(expected)) {
        if (!deepEqual(inner?.[key], value)) {
          throw new Error(`Expected error.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(inner?.[key])}`)
        }
      }
      return tr
    },
  }
  return tr
}

/**
 * Create an HTTP test client for making requests to your Tekir app.
 * Returns an object with get, post, put, patch, delete, head methods plus
 * withHeader, withToken, and withBasicAuth helpers.
 *
 * @param {string} baseUrl - The base URL of the test server (e.g. 'http://localhost:3000')
 * @returns {{ get: Function; post: Function; put: Function; patch: Function; delete: Function; head: Function; withHeader: Function; withToken: Function; withBasicAuth: Function }} HTTP client
 *
 * @example
 * ```ts
 * const c = client('http://localhost:3000')
 *
 * const res = await c.get('/api/users')
 * res.assertOk()
 *    .assertHeader('content-type', 'application/json')
 *
 * const res2 = await c.post('/api/users', {
 *   body: { name: 'Test', email: 'test@tekir.dev' }
 * })
 * res2.assertCreated()
 * ```
 */
export function client(baseUrl: string) {
  async function request(method: string, path: string, opts: RequestOptions = {}): Promise<TestResponse> {
    let url = `${baseUrl}${path}`
    if (opts.query) {
      const qs = new URLSearchParams(opts.query).toString()
      url += `?${qs}`
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...opts.headers,
    }

    if (opts.cookie) headers['Cookie'] = opts.cookie

    let fetchBody: string | undefined
    if (opts.body && method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json'
      fetchBody = JSON.stringify(opts.body)
    }

    const res = await fetch(url, { method, headers, body: fetchBody })

    // For streaming endpoints (SSE, long-poll, downloads) skip the body
    // drain — `await res.text()` would otherwise hang until the stream
    // closes, breaking simple status/header assertions.
    if (opts.stream) {
      return createTestResponse(res, '', undefined)
    }

    const text = await res.text()
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { parsed = text }

    return createTestResponse(res, text, parsed)
  }

  return {
    get: (path: string, opts?: RequestOptions) => request('GET', path, opts),
    post: (path: string, opts?: RequestOptions) => request('POST', path, opts),
    put: (path: string, opts?: RequestOptions) => request('PUT', path, opts),
    patch: (path: string, opts?: RequestOptions) => request('PATCH', path, opts),
    delete: (path: string, opts?: RequestOptions) => request('DELETE', path, opts),
    head: (path: string, opts?: RequestOptions) => request('HEAD', path, opts),
    options: (path: string, opts?: RequestOptions) => request('OPTIONS', path, opts),

    /** Set a default header for all requests */
    withHeader(name: string, value: string) {
      const original = this
      return {
        ...original,
        get: (path: string, opts?: RequestOptions) => request('GET', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
        post: (path: string, opts?: RequestOptions) => request('POST', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
        put: (path: string, opts?: RequestOptions) => request('PUT', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
        patch: (path: string, opts?: RequestOptions) => request('PATCH', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
        delete: (path: string, opts?: RequestOptions) => request('DELETE', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
        head: (path: string, opts?: RequestOptions) => request('HEAD', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
        options: (path: string, opts?: RequestOptions) => request('OPTIONS', path, { ...opts, headers: { ...opts?.headers, [name]: value } }),
      }
    },

    /** Set Bearer token for all requests */
    withToken(token: string) {
      return this.withHeader('Authorization', `Bearer ${token}`)
    },

    /** Set basic auth for all requests */
    withBasicAuth(username: string, password: string) {
      const encoded = Buffer.from(`${username}:${password}`).toString('base64')
      return this.withHeader('Authorization', `Basic ${encoded}`)
    },
  }
}
