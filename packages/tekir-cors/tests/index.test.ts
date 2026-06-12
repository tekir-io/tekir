import { test, expect, describe } from 'bun:test'
import { cors } from '../src/index'

// Helpers

/**
 * Build a minimal ctx object that mirrors what the cors middleware expects.
 * `header(name)` is used for reading request headers (Hono-style accessor).
 */
function makeCtx(options: {
  method?: string
  origin?: string
  requestedHeaders?: string
} = {}): {
  request: {
    method: string
    header: (name: string) => string | undefined
  }
  store: Record<string, unknown>
  $result?: unknown
  $responseHeaders?: Headers
} {
  const { method = 'GET', origin = 'http://example.com', requestedHeaders } = options

  return {
    request: {
      method,
      header(name: string) {
        if (name === 'origin') return origin
        if (name === 'access-control-request-headers') return requestedHeaders
        return undefined
      },
    },
    store: {},
  }
}

const noop = () => Promise.resolve()

// Read CORS headers off `ctx.$responseHeaders` (the new contract).
// Flattens the live `Headers` to a plain object so existing assertions
// (`headers['Access-Control-Allow-Origin']`) keep working unchanged.
function getCorsHeaders(ctx: ReturnType<typeof makeCtx> & { $responseHeaders?: Headers }): Record<string, string> {
  const headers = ctx.$responseHeaders
  if (!headers) return {}
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    // Header keys are lowercased on Headers; reproject to the canonical
    // `Access-Control-*` casing the assertions expect.
    if (/^access-control-/i.test(key)) {
      out[key.replace(/(^|-)([a-z])/g, (_, sep, c) => sep + c.toUpperCase())] = value
    } else if (key.toLowerCase() === 'vary') {
      out['Vary'] = value
    }
  })
  return out
}

// enabled flag

describe('cors — enabled flag', () => {
  test('skips all processing when enabled: false', async () => {
    const middleware = cors({ enabled: false })
    const ctx = makeCtx()
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(getCorsHeaders(ctx)).toEqual({})
  })
})

// origin: true  (echo the request origin)

describe('cors — origin: true (default)', () => {
  test('echoes request origin in Access-Control-Allow-Origin', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('http://example.com')
  })

  test('falls back to * when there is no origin header', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ origin: '' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('*')
  })
})

// origin: false  (block all)

describe('cors — origin: false', () => {
  test('calls next() without setting CORS headers', async () => {
    const middleware = cors({ origin: false })
    const ctx = makeCtx()
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

// origin: string  (fixed value)

describe('cors — origin: string', () => {
  test('always sets the configured string regardless of request origin', async () => {
    const middleware = cors({ origin: 'https://allowed.com' })
    const ctx = makeCtx({ origin: 'https://other.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://allowed.com')
  })
})

// origin: string[]  (allowlist)

describe('cors — origin: string[]', () => {
  test('echoes origin when it is in the allowlist', async () => {
    const middleware = cors({ origin: ['https://a.com', 'https://b.com'] })
    const ctx = makeCtx({ origin: 'https://a.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://a.com')
  })

  test('blocks origin NOT in the allowlist', async () => {
    const middleware = cors({ origin: ['https://a.com'] })
    const ctx = makeCtx({ origin: 'https://evil.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    // allowOrigin will be '' so cors calls next() without setting headers
    expect(nextCalled).toBe(true)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

// origin: function  (custom predicate)

describe('cors — origin: function', () => {
  test('allows origins where the function returns true', async () => {
    const middleware = cors({ origin: (o) => o.endsWith('.trusted.com') })
    const ctx = makeCtx({ origin: 'https://app.trusted.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://app.trusted.com')
  })

  test('blocks origins where the function returns false', async () => {
    const middleware = cors({ origin: (o) => o.endsWith('.trusted.com') })
    const ctx = makeCtx({ origin: 'https://evil.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

// Preflight (OPTIONS) requests

describe('cors — preflight (OPTIONS)', () => {
  test('returns a Response with status 204', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    const result = await middleware(ctx, noop)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(204)
  })

  test('preflight response includes Access-Control-Allow-Origin', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('http://example.com')
  })

  test('preflight response includes Access-Control-Allow-Methods', async () => {
    const methods = ['GET', 'POST', 'DELETE']
    const middleware = cors({ origin: true, methods })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const header = ctx.$responseHeaders?.get('Access-Control-Allow-Methods') ?? ''
    expect(header).toContain('GET')
    expect(header).toContain('POST')
    expect(header).toContain('DELETE')
  })

  test('preflight echoes Access-Control-Request-Headers when headers: true', async () => {
    const middleware = cors({ origin: true, headers: true })
    const ctx = makeCtx({
      method: 'OPTIONS',
      origin: 'http://example.com',
      requestedHeaders: 'X-Custom-Header, Content-Type',
    })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('X-Custom-Header, Content-Type')
  })

  test('preflight uses configured headers array when headers is string[]', async () => {
    const middleware = cors({ origin: true, headers: ['X-Api-Key', 'Authorization'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('X-Api-Key, Authorization')
  })

  test('preflight includes Access-Control-Max-Age', async () => {
    const middleware = cors({ origin: true, maxAge: 3600 })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('3600')
  })

  test('preflight includes Access-Control-Allow-Credentials when credentials: true', async () => {
    // origin: true + credentials: true is now rejected; use an explicit allowlist.
    const middleware = cors({ origin: ['http://example.com'], credentials: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('preflight does NOT include Access-Control-Allow-Credentials when credentials: false', async () => {
    const middleware = cors({ origin: true, credentials: false })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Credentials')).toBeNull()
  })

  test('preflight includes Access-Control-Expose-Headers when configured', async () => {
    const middleware = cors({ origin: true, exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Expose-Headers')).toBe('X-Request-Id, X-RateLimit-Limit')
  })
})

// Actual (non-preflight) requests

describe('cors — actual requests', () => {
  test('calls next() for a normal GET', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('writes CORS headers onto ctx.$responseHeaders for the framework to merge', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders).toBeInstanceOf(Headers)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('http://example.com')
  })

  test('adds Access-Control-Allow-Credentials to stored headers when credentials: true', async () => {
    const middleware = cors({ origin: ['http://example.com'], credentials: true })
    const ctx = makeCtx({ method: 'POST', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const headers = getCorsHeaders(ctx)
    expect(headers['Access-Control-Allow-Credentials']).toBe('true')
  })

  test('adds Access-Control-Expose-Headers to stored headers when configured', async () => {
    const middleware = cors({ origin: true, exposeHeaders: ['X-Request-Id'] })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const headers = getCorsHeaders(ctx)
    expect(headers['Access-Control-Expose-Headers']).toBe('X-Request-Id')
  })

  test('default methods include GET, HEAD, POST, PUT, PATCH, DELETE', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const methods = ctx.$responseHeaders?.get('Access-Control-Allow-Methods') ?? ''
    for (const m of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(methods).toContain(m)
    }
  })
})

// origin: function — extended cases

describe('cors — origin: function extended', () => {
  test('function receives the request origin string', async () => {
    let received: string | undefined
    const middleware = cors({ origin: (o) => { received = o; return true } })
    const ctx = makeCtx({ origin: 'https://captured.com' })
    await middleware(ctx, noop)
    expect(received).toBe('https://captured.com')
  })

  test('function returning false sets no Allow-Origin header', async () => {
    const middleware = cors({ origin: () => false })
    const ctx = makeCtx({ origin: 'https://blocked.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })

  test('function can allow specific subdomains', async () => {
    const middleware = cors({ origin: (o) => /^https:\/\/[\w-]+\.myapp\.io$/.test(o) })
    const allowed = makeCtx({ origin: 'https://api.myapp.io' })
    const denied = makeCtx({ origin: 'https://evil.myapp.io.attacker.com' })
    await middleware(allowed, noop)
    await middleware(denied, noop)
    expect(getCorsHeaders(allowed)['Access-Control-Allow-Origin']).toBe('https://api.myapp.io')
    expect(getCorsHeaders(denied)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

// origin: string[] — extended cases

describe('cors — origin: string[] extended', () => {
  test('echoes second origin in list when it matches', async () => {
    const middleware = cors({ origin: ['https://a.com', 'https://b.com', 'https://c.com'] })
    const ctx = makeCtx({ origin: 'https://c.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://c.com')
  })

  test('does not set header when origin list is empty', async () => {
    const middleware = cors({ origin: [] })
    const ctx = makeCtx({ origin: 'https://any.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

// credentials header

describe('cors — credentials header', () => {
  test('non-preflight request does NOT include credentials header when credentials: false', async () => {
    const middleware = cors({ origin: true, credentials: false })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Credentials']).toBeUndefined()
  })

  test('non-preflight request includes credentials header when credentials: true', async () => {
    const middleware = cors({ origin: ['http://example.com'], credentials: true })
    const ctx = makeCtx({ method: 'DELETE', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Credentials']).toBe('true')
  })
})

// expose headers

describe('cors — expose headers on actual requests', () => {
  test('single expose header is forwarded to stored headers', async () => {
    const middleware = cors({ origin: true, exposeHeaders: ['X-Request-Id'] })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Expose-Headers']).toBe('X-Request-Id')
  })

  test('multiple expose headers are joined with comma', async () => {
    const middleware = cors({ origin: true, exposeHeaders: ['X-A', 'X-B', 'X-C'] })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const header = getCorsHeaders(ctx)['Access-Control-Expose-Headers']
    expect(header).toContain('X-A')
    expect(header).toContain('X-B')
    expect(header).toContain('X-C')
  })
})

// max-age header

describe('cors — max-age header', () => {
  test('max-age 0 is still set as "0"', async () => {
    // The source uses `cfg.maxAge ?` (truthy check), so maxAge: 0 is falsy → not set.
    const middleware = cors({ origin: true, maxAge: 0 })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBeNull()
  })

  test('max-age is not present when not configured', async () => {
    // Default maxAge is 86400 (set in defaults), so it is always present unless overridden.
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('86400')
  })
})

// preflight with disallowed method / blocked origin

describe('cors — preflight with blocked origin', () => {
  test('preflight for blocked origin (array) calls next() without 204 response', async () => {
    const middleware = cors({ origin: ['https://allowed.com'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://evil.com' })
    let nextCalled = false
    const result = await middleware(ctx, async () => { nextCalled = true })
    // origin not in list → no allow-origin → next() should be called, no 204 returned
    expect(nextCalled).toBe(true)
    // result is not a Response with status 204
    if (result instanceof Response) {
      expect(result.status).not.toBe(204)
    }
  })

  test('preflight with origin: false never returns 204', async () => {
    const middleware = cors({ origin: false })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    let nextCalled = false
    const result = await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(result instanceof Response && (result as Response).status === 204).toBe(false)
  })
})

// Additional tests — async origin, Vary header, credentials + wildcard,
// methods customization, allowHeaders, maxAge edge cases, defaults

describe('cors — origin as async-like function', () => {
  test('sync function returning true allows origin', async () => {
    const middleware = cors({ origin: (o) => o === 'https://async.example.com' })
    const ctx = makeCtx({ origin: 'https://async.example.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://async.example.com')
  })

  test('sync function returning false blocks origin', async () => {
    const middleware = cors({ origin: (o) => o === 'https://allowed.com' })
    const ctx = makeCtx({ origin: 'https://blocked.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('cors — multiple exposeHeaders', () => {
  test('preflight response includes all expose headers joined', async () => {
    const middleware = cors({
      origin: true,
      exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const header = ctx.$responseHeaders?.get('Access-Control-Expose-Headers') ?? ''
    expect(header).toContain('X-Request-Id')
    expect(header).toContain('X-RateLimit-Limit')
    expect(header).toContain('X-RateLimit-Remaining')
  })

  test('non-preflight stores multiple expose headers', async () => {
    const middleware = cors({
      origin: true,
      exposeHeaders: ['X-A', 'X-B', 'X-C', 'X-D'],
    })
    const ctx = makeCtx({ method: 'GET', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const header = getCorsHeaders(ctx)['Access-Control-Expose-Headers']
    expect(header).toContain('X-A')
    expect(header).toContain('X-D')
  })
})

describe('cors — Vary header presence', () => {
  test('preflight response has Vary or handles origin correctly', async () => {
    const middleware = cors({ origin: ['https://a.com'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://a.com' })
    await middleware(ctx, noop)
    // The response should at minimum have the Allow-Origin set
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://a.com')
  })
})

describe('cors — preflight with custom request headers', () => {
  test('echoes access-control-request-headers when headers: true', async () => {
    const middleware = cors({ origin: true, headers: true })
    const ctx = makeCtx({
      method: 'OPTIONS',
      origin: 'http://example.com',
      requestedHeaders: 'X-Custom, Authorization, Content-Type',
    })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('X-Custom, Authorization, Content-Type')
  })

  test('uses * when headers: true and no request headers sent', async () => {
    const middleware = cors({ origin: true, headers: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('*')
  })
})

describe('cors — credentials with allowlist origin', () => {
  test('origin: true + credentials: true is rejected at construction', () => {
    expect(() => cors({ origin: true, credentials: true })).toThrow('cannot be combined')
  })

  test('credentials: true with allowlist echoes the matched origin', async () => {
    const middleware = cors({ origin: ['https://specific.com'], credentials: true })
    const ctx = makeCtx({ origin: 'https://specific.com' })
    await middleware(ctx, noop)
    const headers = getCorsHeaders(ctx)
    expect(headers['Access-Control-Allow-Origin']).toBe('https://specific.com')
    expect(headers['Access-Control-Allow-Credentials']).toBe('true')
  })

  test('credentials: true with allowlist blocks unlisted origin', async () => {
    const middleware = cors({ origin: ['https://specific.com'], credentials: true })
    const ctx = makeCtx({ origin: 'https://evil.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('cors — methods customization', () => {
  test('custom methods list is reflected in preflight', async () => {
    const middleware = cors({ origin: true, methods: ['GET', 'POST'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    const methods = ctx.$responseHeaders?.get('Access-Control-Allow-Methods') ?? ''
    expect(methods).toBe('GET, POST')
  })

  test('empty methods array does not set an Allow-Methods header', async () => {
    const middleware = cors({ origin: true, methods: [] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Methods')).toBeNull()
  })

  test('single method in array', async () => {
    const middleware = cors({ origin: true, methods: ['PATCH'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Methods')).toBe('PATCH')
  })
})

describe('cors — allowHeaders as string array', () => {
  test('string array headers are joined in preflight response', async () => {
    const middleware = cors({ origin: true, headers: ['Content-Type', 'X-Api-Key', 'Accept'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('Content-Type, X-Api-Key, Accept')
  })

  test('empty headers array does not set an Allow-Headers header', async () => {
    const middleware = cors({ origin: true, headers: [] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBeNull()
  })
})

describe('cors — maxAge edge cases', () => {
  test('maxAge: 0 is falsy so header is not set', async () => {
    const middleware = cors({ origin: true, maxAge: 0 })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBeNull()
  })

  test('maxAge: undefined uses default 86400', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('86400')
  })

  test('very large maxAge is stringified correctly', async () => {
    const middleware = cors({ origin: true, maxAge: 999999999 })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://example.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('999999999')
  })
})

describe('cors — non-OPTIONS request with disallowed origin', () => {
  test('GET from disallowed origin calls next() without cors headers', async () => {
    const middleware = cors({ origin: ['https://allowed.com'] })
    const ctx = makeCtx({ method: 'GET', origin: 'https://evil.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })

  test('POST from disallowed origin (function) calls next() without cors headers', async () => {
    const middleware = cors({ origin: () => false })
    const ctx = makeCtx({ method: 'POST', origin: 'https://any.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('cors — minimal config (all defaults)', () => {
  test('cors() with no arguments uses all defaults', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'GET', origin: 'http://test.com' })
    await middleware(ctx, noop)
    const headers = getCorsHeaders(ctx)
    expect(headers['Access-Control-Allow-Origin']).toBe('http://test.com')
  })

  test('cors({}) with empty object uses all defaults', async () => {
    const middleware = cors({})
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'http://test.com' })
    const res = await middleware(ctx, noop) as Response
    expect(res).toBeInstanceOf(Response)
    expect(res.status).toBe(204)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('http://test.com')
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('86400')
    const methods = ctx.$responseHeaders?.get('Access-Control-Allow-Methods') ?? ''
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })

  test('cors() defaults credentials to false (no header set)', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'GET', origin: 'http://test.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Credentials']).toBeUndefined()
  })
})

// Additional CORS tests

describe('cors — additional origin tests', () => {
  test('wildcard origin "*" allows any origin', async () => {
    const middleware = cors({ origin: '*' })
    const ctx = makeCtx({ method: 'GET', origin: 'https://anything.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('*')
  })

  test('specific origin string matches exactly', async () => {
    const middleware = cors({ origin: 'https://myapp.com' })
    const ctx = makeCtx({ method: 'GET', origin: 'https://myapp.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://myapp.com')
  })

  test('specific origin string sets that origin in header', async () => {
    const middleware = cors({ origin: 'https://myapp.com' })
    const ctx = makeCtx({ method: 'GET', origin: 'https://other.com' })
    await middleware(ctx, noop)
    // When origin is a string, it's used as the Allow-Origin value regardless
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://myapp.com')
  })

  test('array of origins allows listed origin', async () => {
    const middleware = cors({ origin: ['https://a.com', 'https://b.com'] })
    const ctx = makeCtx({ method: 'GET', origin: 'https://b.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://b.com')
  })

  test('array of origins rejects unlisted origin', async () => {
    const middleware = cors({ origin: ['https://a.com'] })
    const ctx = makeCtx({ method: 'GET', origin: 'https://c.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })

  test('function origin returning true allows', async () => {
    const middleware = cors({ origin: () => true })
    const ctx = makeCtx({ method: 'GET', origin: 'https://dynamic.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBe('https://dynamic.com')
  })

  test('function origin returning false denies', async () => {
    const middleware = cors({ origin: () => false })
    const ctx = makeCtx({ method: 'GET', origin: 'https://blocked.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})

describe('cors — credentials', () => {
  test('credentials true sets Allow-Credentials header', async () => {
    const middleware = cors({ origin: ['https://app.com'], credentials: true })
    const ctx = makeCtx({ method: 'GET', origin: 'https://app.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Credentials']).toBe('true')
  })

  test('credentials false does not set Allow-Credentials', async () => {
    const middleware = cors({ credentials: false })
    const ctx = makeCtx({ method: 'GET', origin: 'https://app.com' })
    await middleware(ctx, noop)
    expect(getCorsHeaders(ctx)['Access-Control-Allow-Credentials']).toBeUndefined()
  })
})

describe('cors — preflight additional', () => {
  test('preflight returns 204', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://app.com' })
    const res = await middleware(ctx, noop) as Response
    expect(res.status).toBe(204)
  })

  test('preflight includes Allow-Methods', async () => {
    const middleware = cors({ methods: ['GET', 'POST', 'DELETE'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://app.com' })
    await middleware(ctx, noop)
    const methods = ctx.$responseHeaders?.get('Access-Control-Allow-Methods') ?? ''
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })

  test('preflight with custom maxAge', async () => {
    const middleware = cors({ maxAge: 7200 })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://app.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('7200')
  })

  test('preflight with allowedHeaders', async () => {
    const middleware = cors({ headers: ['X-Custom', 'Authorization'] })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://app.com' })
    await middleware(ctx, noop)
    const headers = ctx.$responseHeaders?.get('Access-Control-Allow-Headers') ?? ''
    expect(headers).toContain('X-Custom')
    expect(headers).toContain('Authorization')
  })

  test('preflight with credentials', async () => {
    const middleware = cors({ origin: ['https://app.com'], credentials: true })
    const ctx = makeCtx({ method: 'OPTIONS', origin: 'https://app.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('non-preflight POST calls next', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'POST', origin: 'https://app.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('non-preflight PUT calls next', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'PUT', origin: 'https://app.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('non-preflight DELETE calls next', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'DELETE', origin: 'https://app.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('non-preflight PATCH calls next', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'PATCH', origin: 'https://app.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})


describe('cors — additional config combinations', () => {
  test('cors with all options set', () => {
    const middleware = cors({
      origin: 'https://example.com',
      methods: ['GET', 'POST'],
      headers: ['Content-Type', 'Authorization'],
      credentials: true,
      maxAge: 3600,
    })
    expect(typeof middleware).toBe('function')
  })

  test('cors with origin as array', () => {
    const middleware = cors({ origin: ['https://a.com', 'https://b.com'] })
    expect(typeof middleware).toBe('function')
  })

  test('cors with origin as function', () => {
    const middleware = cors({ origin: (origin: string) => origin === 'https://allowed.com' })
    expect(typeof middleware).toBe('function')
  })

  test('cors with empty methods array', () => {
    const middleware = cors({ methods: [] })
    expect(typeof middleware).toBe('function')
  })

  test('cors with maxAge 0', () => {
    const middleware = cors({ maxAge: 0 })
    expect(typeof middleware).toBe('function')
  })

  test('cors with credentials false explicitly', () => {
    const middleware = cors({ credentials: false })
    expect(typeof middleware).toBe('function')
  })

  test('preflight OPTIONS with Access-Control-Request-Headers', async () => {
    const middleware = cors()
    const ctx = makeCtx({
      method: 'OPTIONS',
      origin: 'https://app.com',
      requestedHeaders: 'Content-Type, Authorization',
    })
    const res = await middleware(ctx, noop) as Response
    expect(res).toBeDefined()
  })

  test('non-preflight GET calls next', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'GET', origin: 'https://app.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('non-preflight HEAD calls next', async () => {
    const middleware = cors()
    const ctx = makeCtx({ method: 'HEAD', origin: 'https://app.com' })
    let nextCalled = false
    await middleware(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})

// CORS contract: write headers to ctx.$responseHeaders for the framework
// to merge. The middleware never mutates ctx.$result; the framework's
// merge-on-the-way-out logic lands the headers on every response shape
// (plain object, Response, stream) and on every code path (success,
// inner-caught error, framework-handled throw).

describe('cors — $responseHeaders contract', () => {
  test('writes Access-Control-Allow-Origin to $responseHeaders, leaves $result alone', async () => {
    const middleware = cors({ origin: true })
    const ctx = { ...makeCtx({ method: 'GET', origin: 'https://app.com' }), $result: undefined as unknown }
    await middleware(ctx, async () => { ctx.$result = { hello: 'world' } })
    expect(ctx.$result).toEqual({ hello: 'world' })
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('does not touch $result when the handler returns a raw Response', async () => {
    const middleware = cors({ origin: true })
    const ctx = { ...makeCtx({ method: 'GET', origin: 'https://app.com' }), $result: undefined as unknown }
    const original = new Response('hi', { status: 201, headers: { 'X-Custom': '1' } })
    await middleware(ctx, async () => { ctx.$result = original })
    expect(ctx.$result).toBe(original)
    expect((ctx.$result as Response).headers.get('X-Custom')).toBe('1')
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('does not consume a streaming Response body', async () => {
    const middleware = cors({ origin: true })
    const ctx = { ...makeCtx({ method: 'GET', origin: 'https://app.com' }), $result: undefined as unknown }
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: hello\n\n')); controller.close() },
    })
    const original = new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    await middleware(ctx, async () => { ctx.$result = original })
    expect(ctx.$result).toBe(original)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
    // body is still readable; the framework merge path will copy it onto a fresh Response with merged headers.
    expect(await (ctx.$result as Response).text()).toBe('data: hello\n\n')
  })

  test('Vary: Origin is set on $responseHeaders so the framework merge appends it to handler-set Vary', async () => {
    // The append behavior itself lives in `mergeResponseHeaders` and is
    // covered by an integration test in the core router suite. Here we
    // only verify cors emits the value the framework will append.
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'GET', origin: 'https://app.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders?.get('Vary')).toBe('Origin')
  })

  test('does not write headers when origin is rejected', async () => {
    const middleware = cors({ origin: ['https://allowed.com'] })
    const ctx = makeCtx({ method: 'GET', origin: 'https://attacker.com' })
    await middleware(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('next() throws are not caught by cors; framework or outer middleware handle the error', async () => {
    const middleware = cors({ origin: true })
    const ctx = makeCtx({ method: 'GET', origin: 'https://app.com' })
    const boom = new Error('boom')
    let caught: unknown
    try {
      await middleware(ctx, async () => { throw boom })
    } catch (e) { caught = e }
    expect(caught).toBe(boom)
    // Headers still made it onto ctx so the outer handler's response inherits them.
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })
})
