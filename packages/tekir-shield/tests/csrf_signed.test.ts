import { test, expect, describe } from 'bun:test'
import { csrf, csrfToken, rotateCsrfToken } from '../src/index'
import type { ShieldContext } from '../src/types'

function makeCtx(method = 'POST') {
  const _headers: Record<string, string> = {}
  const _session: Record<string, unknown> = {}
  const ctx = {
    request: { method, url: 'http://localhost/submit', headers: {} as Record<string, any>, body: {} as Record<string, any> },
    response: { headers: _headers, setHeader(n: string, v: string) { _headers[n] = v } },
    session: { get: (k: string) => _session[k] ?? null, set: (k: string, v: unknown) => { _session[k] = v } },
    throw(status: number, message: string): never { throw Object.assign(new Error(message), { status }) },
    _headers,
    _session,
  }
  return ctx as unknown as ShieldContext & { _session: Record<string, unknown> }
}

const noop = () => Promise.resolve()
const SECRET = 'super-secret-app-key'

describe('CSRF signed tokens', () => {
  test('emitted token is signed (random.hmac) and not the stored raw value', () => {
    const ctx = makeCtx()
    const token = csrfToken(ctx, undefined, SECRET)
    expect(token).toContain('.')
    const stored = ctx._session['_csrfToken'] as string
    expect(stored).not.toContain('.')
    expect(token.startsWith(stored + '.')).toBe(true)
  })

  test('valid signed token passes validation', async () => {
    const ctx = makeCtx()
    const token = csrfToken(ctx, undefined, SECRET)
    ctx.request.body = { _csrf: token }
    let called = false
    await csrf({ secret: SECRET })(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('token with tampered signature is rejected', async () => {
    const ctx = makeCtx()
    const token = csrfToken(ctx, undefined, SECRET)
    const [raw] = token.split('.')
    ctx.request.body = { _csrf: `${raw}.deadbeef` }
    await expect(csrf({ secret: SECRET })(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })

  test('a forged token built from a known/leaked raw value fails without the secret', async () => {
    const ctx = makeCtx()
    // Attacker knows the stored raw (e.g. shared session store) but not the secret.
    csrfToken(ctx, undefined, SECRET)
    const stolenRaw = ctx._session['_csrfToken'] as string
    const forged = `${stolenRaw}.${'0'.repeat(64)}`
    ctx.request.body = { _csrf: forged }
    await expect(csrf({ secret: SECRET })(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })

  test('a signed token from a different secret is rejected', async () => {
    const ctx = makeCtx()
    const token = csrfToken(ctx, undefined, 'other-secret')
    ctx.request.body = { _csrf: token }
    await expect(csrf({ secret: SECRET })(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })
})

describe('CSRF rotation', () => {
  test('rotateCsrfToken replaces the stored value', () => {
    const ctx = makeCtx()
    csrfToken(ctx, undefined, SECRET)
    const before = ctx._session['_csrfToken']
    rotateCsrfToken(ctx, undefined, SECRET)
    const after = ctx._session['_csrfToken']
    expect(after).not.toBe(before)
  })

  test('rotateOnUse makes a token single-use', async () => {
    const ctx = makeCtx()
    const token = csrfToken(ctx, undefined, SECRET)

    // First use succeeds.
    ctx.request.body = { _csrf: token }
    await csrf({ secret: SECRET, rotateOnUse: true })(ctx, noop)

    // Replaying the same token now fails because the stored raw rotated.
    ctx.request.body = { _csrf: token }
    await expect(csrf({ secret: SECRET, rotateOnUse: true })(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })
})

describe('CSRF fail-closed when no session token established', () => {
  test('a request with no stored token is rejected (no lazy mint on validate)', async () => {
    const ctx = makeCtx()
    // No csrfToken() was ever called, so session has nothing.
    ctx.request.body = { _csrf: 'anything' }
    await expect(csrf({ secret: SECRET })(ctx, noop)).rejects.toMatchObject({ status: 403 })
    expect(ctx._session['_csrfToken']).toBeUndefined()
  })
})

describe('CSRF unsigned mode still works (no secret)', () => {
  test('raw token round-trips without a secret', async () => {
    const ctx = makeCtx()
    const token = csrfToken(ctx)
    expect(token).not.toContain('.')
    ctx.request.body = { _csrf: token }
    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})
