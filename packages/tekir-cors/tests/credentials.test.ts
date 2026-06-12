import { test, expect, describe } from 'bun:test'
import { cors } from '../src/cors'

// Regression coverage for the credentials + origin hardening:
//  - origin:true + credentials:true must never reflect an arbitrary Origin.
//  - `Origin: null` must not be trusted when credentials are enabled.
//  - `headers: true` must not emit `*` for credentialed preflight.

function makeCtx(origin = '', method = 'GET', requestedHeaders?: string) {
  return {
    request: {
      header: (name: string) =>
        name === 'origin' ? origin
        : name === 'access-control-request-headers' ? (requestedHeaders ?? '')
        : '',
      method,
      raw: { method },
    },
    headers: { origin },
    $responseHeaders: undefined as Headers | undefined,
  }
}
const noop = () => Promise.resolve()

describe('cors credentials hardening', () => {
  test('origin:true + credentials:true throws (no wildcard-with-credentials)', () => {
    expect(() => cors({ origin: true, credentials: true })).toThrow('cannot be combined')
  })

  test('array allowlist + credentials reflects only listed origins', async () => {
    const mw = cors({ origin: ['https://app.com'], credentials: true })
    const ok = makeCtx('https://app.com')
    const bad = makeCtx('https://attacker.com')
    await mw(ok, noop)
    await mw(bad, noop)
    expect(ok.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
    expect(ok.$responseHeaders?.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(bad.$responseHeaders).toBeUndefined()
  })

  test('function origin + credentials still works (explicit validator)', async () => {
    const mw = cors({ origin: (o) => o === 'https://app.com', credentials: true })
    const ctx = makeCtx('https://app.com')
    await mw(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('https://app.com')
  })

  test('Origin: null is not trusted with credentials', async () => {
    const mw = cors({ origin: () => true, credentials: true })
    const ctx = makeCtx('null')
    await mw(ctx, noop)
    expect(ctx.$responseHeaders).toBeUndefined()
  })

  test('Origin: null without credentials may still be reflected', async () => {
    const mw = cors({ origin: () => true })
    const ctx = makeCtx('null')
    await mw(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Origin')).toBe('null')
  })
})

describe('cors preflight Allow-Headers with credentials', () => {
  test('credentials preflight echoes requested headers, never *', async () => {
    const mw = cors({ origin: ['https://app.com'], credentials: true })
    const requested = makeCtx('https://app.com', 'OPTIONS', 'X-Custom, Content-Type')
    await mw(requested, noop)
    expect(requested.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('X-Custom, Content-Type')
  })

  test('credentials preflight with no requested headers omits Allow-Headers (no *)', async () => {
    const mw = cors({ origin: ['https://app.com'], credentials: true })
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await mw(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBeNull()
  })

  test('non-credentialed preflight may still use * when nothing requested', async () => {
    const mw = cors({ origin: true, headers: true })
    const ctx = makeCtx('https://app.com', 'OPTIONS')
    await mw(ctx, noop)
    expect(ctx.$responseHeaders?.get('Access-Control-Allow-Headers')).toBe('*')
  })
})
