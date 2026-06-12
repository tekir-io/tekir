import { test, expect, describe } from 'bun:test'
import { cors } from '../src/cors'

function makeCtx(origin = '', method = 'GET') {
  return {
    request: { header: (n: string) => n === 'origin' ? origin : n === 'access-control-request-headers' ? 'Content-Type' : '', method, raw: { method } },
    headers: { origin },
    store: {} as any,
    $result: undefined as any,
    $responseHeaders: undefined as Headers | undefined,
  }
}
const noop = () => Promise.resolve()

describe('CORS — expose headers', () => {
  test('exposeHeaders are set', async () => {
    const ctx = makeCtx('https://app.com', 'GET')
    await cors({ origin: true, exposeHeaders: ['X-Total', 'X-Page'] })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Expose-Headers') ?? undefined).toBe('X-Total, X-Page')
  })

  test('no exposeHeaders by default', async () => {
    const ctx = makeCtx('https://app.com', 'GET')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Expose-Headers') ?? undefined).toBeUndefined()
  })
})

describe('CORS — methods', () => {
  test('custom methods in preflight', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true, methods: ['GET', 'POST', 'PATCH'] })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Methods')).toBe('GET, POST, PATCH')
  })

  test('default methods include standard set', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true })(ctx, noop)
    const methods = ctx.$responseHeaders?.get('Access-Control-Allow-Methods') ?? ''
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
    expect(methods).toContain('DELETE')
  })
})

describe('CORS — headers config', () => {
  test('headers: true reflects request headers', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true, headers: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('Content-Type')
  })

  test('headers: array uses specified', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true, headers: ['Authorization', 'X-Custom'] })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('Authorization, X-Custom')
  })
})

describe('CORS — maxAge', () => {
  test('maxAge is set in preflight', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true, maxAge: 7200 })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('7200')
  })

  test('default maxAge is 86400', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Max-Age')).toBe('86400')
  })
})

describe('CORS — non-OPTIONS requests', () => {
  test('GET sets CORS headers via store', async () => {
    const ctx = makeCtx('https://app.com', 'GET')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('POST sets CORS headers via store', async () => {
    const ctx = makeCtx('https://app.com', 'POST')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('PUT sets CORS headers via store', async () => {
    const ctx = makeCtx('https://app.com', 'PUT')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('DELETE sets CORS headers via store', async () => {
    const ctx = makeCtx('https://app.com', 'DELETE')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('PATCH sets CORS headers via store', async () => {
    const ctx = makeCtx('https://app.com', 'PATCH')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })
})

describe('CORS — next() is called', () => {
  test('non-OPTIONS calls next', async () => {
    const ctx = makeCtx('https://app.com', 'GET')
    let called = false
    await cors({ origin: true })(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('OPTIONS does NOT call next (returns response)', async () => {
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    let called = false
    await cors({ origin: true })(ctx, async () => { called = true })
    expect(called).toBe(false)
  })

  test('disabled cors calls next', async () => {
    const ctx = makeCtx('https://app.com', 'GET')
    let called = false
    await cors({ enabled: false })(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('no matching origin calls next', async () => {
    const ctx = makeCtx('https://evil.com', 'GET')
    let called = false
    await cors({ origin: ['https://app.com'] })(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})

describe('CORS — edge cases', () => {
  test('empty origin header', async () => {
    const ctx = makeCtx('', 'GET')
    await cors({ origin: true })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('*')
  })

  test('null config uses defaults', async () => {
    const ctx = makeCtx('https://app.com', 'GET')
    await cors()(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('string origin exact match', async () => {
    const ctx = makeCtx('https://exact.com', 'GET')
    await cors({ origin: 'https://exact.com' })(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://exact.com')
  })

  test('string origin non-match skips CORS', async () => {
    const ctx = makeCtx('https://other.com', 'GET')
    let nextCalled = false
    await cors({ origin: 'https://exact.com' })(ctx, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
    // No CORS headers set for non-matching string origin
  })
})
