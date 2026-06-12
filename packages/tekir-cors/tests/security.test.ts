import { test, expect, describe } from 'bun:test'
import { cors } from '../src/cors'

function makeCtx(origin = 'https://evil.com', method = 'GET') {
  return {
    request: {
      header: (name: string) => name === 'origin' ? origin : name === 'access-control-request-headers' ? 'Content-Type' : '',
      method,
      raw: { method },
    },
    headers: { origin },
    store: {} as any,
    $result: undefined as any,
    $responseHeaders: undefined as Headers | undefined,
  }
}
const noop = () => Promise.resolve()

// ═══════════════════════════════════════════════════════════
// origin:true + credentials
// ═══════════════════════════════════════════════════════════

describe('CORS — origin:true + credentials', () => {
  test('without credentials uses wildcard when no origin', async () => {
    const ctx = makeCtx('', 'GET')
    await cors({ origin: true, credentials: false })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('origin:true + credentials:true is rejected (no arbitrary reflection)', () => {
    // Reflecting any Origin alongside Allow-Credentials is the classic CORS hole.
    // The middleware now refuses this combination at construction time.
    expect(() => cors({ origin: true, credentials: true })).toThrow('cannot be combined')
  })

  test('credentials requires an explicit allowlist', async () => {
    const ctx = makeCtx('https://example.com')
    await cors({ origin: ['https://example.com'], credentials: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://example.com')
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('credentials allowlist blocks an unlisted origin', async () => {
    const ctx = makeCtx('https://evil.com')
    await cors({ origin: ['https://example.com'], credentials: true })(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('without credentials reflects origin when present', async () => {
    const ctx = makeCtx('https://app.com')
    await cors({ origin: true, credentials: false })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })
})

// ═══════════════════════════════════════════════════════════
// Array origin — case insensitive
// ═══════════════════════════════════════════════════════════

describe('CORS — array origin exact (case-sensitive) match', () => {
  test('exact match works', async () => {
    const ctx = makeCtx('https://app.com')
    await cors({ origin: ['https://app.com'] })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('case-variant origin is NOT matched (RFC 6454 exact comparison)', async () => {
    const ctx = makeCtx('HTTPS://APP.COM')
    await cors({ origin: ['https://app.com'] })(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('mixed-case origin is NOT matched', async () => {
    const ctx = makeCtx('https://App.Com')
    await cors({ origin: ['https://app.com'] })(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('non-matching origin is rejected', async () => {
    const ctx = makeCtx('https://evil.com')
    await cors({ origin: ['https://app.com'] })(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('multiple allowed origins', async () => {
    const allowed = ['https://app.com', 'https://admin.com', 'https://api.com']
    for (const origin of allowed) {
      const ctx = makeCtx(origin)
      await cors({ origin: allowed })(ctx, noop)
      expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe(origin)
    }
  })

  test('multiple origins — non-matching rejected', async () => {
    const ctx = makeCtx('https://hacker.com')
    await cors({ origin: ['https://app.com', 'https://admin.com'] })(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
// Function origin
// ═══════════════════════════════════════════════════════════

describe('CORS — function origin', () => {
  test('function returning true allows origin', async () => {
    const ctx = makeCtx('https://trusted.com')
    await cors({ origin: () => true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://trusted.com')
  })

  test('function returning false rejects origin', async () => {
    const ctx = makeCtx('https://evil.com')
    await cors({ origin: () => false })(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════
// Preflight
// ═══════════════════════════════════════════════════════════

describe('CORS — preflight OPTIONS', () => {
  test('OPTIONS returns 204 with headers', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    const result = await cors({ origin: true })(ctx, noop)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(204)
  })

  test('OPTIONS with credentials uses the allowlisted origin', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: ['https://app.com'], credentials: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  test('OPTIONS includes allowed methods', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true, methods: ['GET', 'POST'] })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Methods')).toBe('GET, POST')
  })

  test('OPTIONS includes max-age', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true, maxAge: 3600 })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('3600')
  })
})

// ═══════════════════════════════════════════════════════════
// Disabled CORS
// ═══════════════════════════════════════════════════════════

describe('CORS — disabled', () => {
  test('enabled: false skips CORS entirely', async () => {
    const ctx = makeCtx('https://app.com')
    let nextCalled = false
    await cors({ enabled: false })(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('origin: false skips CORS', async () => {
    const ctx = makeCtx('https://app.com')
    let nextCalled = false
    await cors({ origin: false })(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('string origin matches exactly', async () => {
    const ctx = makeCtx('https://app.com')
    await cors({ origin: 'https://app.com' })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })
})
