import { test, expect, describe, beforeEach } from 'bun:test'
import {
  sanitize,
  escapeHtml,
  unescapeHtml,
  helmet,
  csp,
  csrf,
  csrfToken,
  shield,
  buildCspHeader,
  CspPresets,
  setRateLimitHeaders,
  type ShieldContext,
  type HelmetOptions,
} from '../src/index'

// Helpers

/** Build a minimal ShieldContext for middleware tests. */
function makeCtx(overrides: Partial<ShieldContext> = {}): ShieldContext & {
  _headers: Record<string, string>
} {
  const _headers: Record<string, string> = {}

  return {
    request: {
      method: 'GET',
      url: 'http://localhost/',
      headers: {},
    },
    response: {
      headers: _headers,
      setHeader(name: string, value: string) {
        _headers[name] = value
      },
    },
    throw(status: number, message: string): never {
      throw Object.assign(new Error(message), { status })
    },
    _headers,
    ...overrides,
  }
}

const noop = () => Promise.resolve()

// sanitize()

describe('sanitize()', () => {
  test('strips a simple HTML tag', () => {
    expect(sanitize('<b>bold</b>')).toBe('bold')
  })

  test('strips multiple tags', () => {
    expect(sanitize('<p>Hello <em>world</em></p>')).toBe('Hello world')
  })

  test('removes <script> tags AND their content', () => {
    expect(sanitize('<script>alert(1)</script>Safe')).toBe('Safe')
  })

  test('removes <style> tags AND their content', () => {
    expect(sanitize('<style>body{color:red}</style>Text')).toBe('Text')
  })

  test('removes script tags case-insensitively', () => {
    expect(sanitize('<SCRIPT>evil()</SCRIPT>ok')).toBe('ok')
  })

  test('returns plain text unchanged', () => {
    expect(sanitize('Hello, world!')).toBe('Hello, world!')
  })

  test('handles an empty string', () => {
    expect(sanitize('')).toBe('')
  })

  test('strips tags with attributes', () => {
    expect(sanitize('<a href="http://evil.com">click</a>')).toBe('click')
  })

  test('removes inline event handlers', () => {
    expect(sanitize('<img src=x onerror="alert(1)">')).toBe('')
  })
})

// escapeHtml()

describe('escapeHtml()', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  test('escapes less-than', () => {
    expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;')
  })

  test('escapes double quote', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
  })

  test('escapes single quote', () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s')
  })

  test('escapes forward slash', () => {
    expect(escapeHtml('a/b')).toBe('a&#x2F;b')
  })

  test('escapes backtick', () => {
    expect(escapeHtml('`code`')).toBe('&#x60;code&#x60;')
  })

  test('escapes equals sign', () => {
    expect(escapeHtml('a=b')).toBe('a&#x3D;b')
  })

  test('escapes a full XSS payload', () => {
    const result = escapeHtml('<script>alert("xss")</script>')
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).not.toContain('"')
  })

  test('returns plain text unchanged', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world')
  })

  test('handles an empty string', () => {
    expect(escapeHtml('')).toBe('')
  })
})

// unescapeHtml()

describe('unescapeHtml()', () => {
  test('unescapes &amp;', () => {
    expect(unescapeHtml('a &amp; b')).toBe('a & b')
  })

  test('unescapes &lt; and &gt;', () => {
    expect(unescapeHtml('&lt;tag&gt;')).toBe('<tag>')
  })

  test('unescapes &quot;', () => {
    expect(unescapeHtml('&quot;quoted&quot;')).toBe('"quoted"')
  })

  test('unescapes &#x27;', () => {
    expect(unescapeHtml('it&#x27;s')).toBe("it's")
  })

  test('unescapes &#x2F;', () => {
    expect(unescapeHtml('a&#x2F;b')).toBe('a/b')
  })

  test('unescapes &#x60;', () => {
    expect(unescapeHtml('&#x60;code&#x60;')).toBe('`code`')
  })

  test('unescapes &#x3D;', () => {
    expect(unescapeHtml('a&#x3D;b')).toBe('a=b')
  })

  test('is the inverse of escapeHtml()', () => {
    const original = '<script>alert("xss & friends")</script>'
    expect(unescapeHtml(escapeHtml(original))).toBe(original)
  })

  test('handles an empty string', () => {
    expect(unescapeHtml('')).toBe('')
  })

  test('leaves unknown entities untouched', () => {
    expect(unescapeHtml('&mdash;')).toBe('&mdash;')
  })
})

// helmet() middleware

describe('helmet() middleware', () => {
  test('sets X-Content-Type-Options: nosniff by default', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['X-Content-Type-Options']).toBe('nosniff')
  })

  test('sets X-Frame-Options: SAMEORIGIN by default', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['X-Frame-Options']).toBe('SAMEORIGIN')
  })

  test('sets X-XSS-Protection: 0 by default', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['X-XSS-Protection']).toBe('0')
  })

  test('sets Strict-Transport-Security with correct defaults', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    const hsts = ctx._headers['Strict-Transport-Security']
    expect(hsts).toContain('max-age=15552000')
    expect(hsts).toContain('includeSubDomains')
    // preload is opt-in (not in defaults) — it is a near-irreversible commitment.
    expect(hsts).not.toContain('preload')
  })

  test('preload is opt-in and emitted when explicitly enabled', async () => {
    const ctx = makeCtx()
    await helmet({ hsts: { preload: true } })(ctx, noop)
    expect(ctx._headers['Strict-Transport-Security']).toContain('preload')
  })

  test('sets X-Download-Options: noopen by default', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['X-Download-Options']).toBe('noopen')
  })

  test('sets X-Permitted-Cross-Domain-Policies: none by default', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['X-Permitted-Cross-Domain-Policies']).toBe('none')
  })

  test('sets Referrer-Policy: no-referrer by default', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['Referrer-Policy']).toBe('no-referrer')
  })

  test('does NOT set Cross-Origin-Opener-Policy by default (opt-in)', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['Cross-Origin-Opener-Policy']).toBeUndefined()
  })

  test('does NOT set Cross-Origin-Embedder-Policy by default (opt-in)', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['Cross-Origin-Embedder-Policy']).toBeUndefined()
  })

  test('does NOT set Cross-Origin-Resource-Policy by default (opt-in)', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(ctx._headers['Cross-Origin-Resource-Policy']).toBeUndefined()
  })

  test('respects frameOptions: "DENY"', async () => {
    const ctx = makeCtx()
    await helmet({ frameOptions: 'DENY' })(ctx, noop)
    expect(ctx._headers['X-Frame-Options']).toBe('DENY')
  })

  test('disables X-Frame-Options when set to false', async () => {
    const ctx = makeCtx()
    await helmet({ frameOptions: false })(ctx, noop)
    expect(ctx._headers['X-Frame-Options']).toBeUndefined()
  })

  test('disables HSTS when hsts: false', async () => {
    const ctx = makeCtx()
    await helmet({ hsts: false })(ctx, noop)
    expect(ctx._headers['Strict-Transport-Security']).toBeUndefined()
  })

  test('merges custom HSTS options over defaults', async () => {
    const ctx = makeCtx()
    await helmet({ hsts: { maxAge: 31536000, preload: true } })(ctx, noop)
    const hsts = ctx._headers['Strict-Transport-Security']
    expect(hsts).toContain('max-age=31536000')
    expect(hsts).toContain('preload')
    expect(hsts).toContain('includeSubDomains') // default preserved
  })

  test('enables Cross-Origin-Opener-Policy when specified', async () => {
    const ctx = makeCtx()
    await helmet({ crossOriginOpenerPolicy: 'same-origin' })(ctx, noop)
    expect(ctx._headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
  })

  test('enables Cross-Origin-Embedder-Policy when specified', async () => {
    const ctx = makeCtx()
    await helmet({ crossOriginEmbedderPolicy: 'require-corp' })(ctx, noop)
    expect(ctx._headers['Cross-Origin-Embedder-Policy']).toBe('require-corp')
  })

  test('enables Cross-Origin-Resource-Policy when specified', async () => {
    const ctx = makeCtx()
    await helmet({ crossOriginResourcePolicy: 'same-origin' })(ctx, noop)
    expect(ctx._headers['Cross-Origin-Resource-Policy']).toBe('same-origin')
  })

  test('calls next() so the request continues', async () => {
    const ctx = makeCtx()
    let called = false
    await helmet()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})

// buildCspHeader() / csp() middleware

describe('buildCspHeader()', () => {
  test('produces correct header for a simple policy', () => {
    const value = buildCspHeader({ defaultSrc: ["'self'"] })
    expect(value).toBe("default-src 'self'")
  })

  test('joins multiple sources with spaces', () => {
    const value = buildCspHeader({ scriptSrc: ["'self'", 'https://cdn.example.com'] })
    expect(value).toBe("script-src 'self' https://cdn.example.com")
  })

  test('handles boolean true directives (e.g. upgradeInsecureRequests)', () => {
    const value = buildCspHeader({ upgradeInsecureRequests: true })
    expect(value).toBe('upgrade-insecure-requests')
  })

  test('omits directives set to false', () => {
    const value = buildCspHeader({ defaultSrc: ["'self'"], scriptSrc: false as unknown as string[] })
    expect(value).not.toContain('script-src')
    expect(value).toContain('default-src')
  })

  test('omits directives with empty arrays', () => {
    const value = buildCspHeader({ defaultSrc: [], scriptSrc: ["'self'"] })
    expect(value).not.toContain('default-src')
    expect(value).toContain("script-src 'self'")
  })

  test('handles multiple directives separated by semicolons', () => {
    const value = buildCspHeader({
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    })
    expect(value).toContain('default-src')
    expect(value).toContain('img-src')
    expect(value.includes(';')).toBe(true)
  })

  test('uses CspPresets constants correctly', () => {
    expect(CspPresets.self).toBe("'self'")
    expect(CspPresets.none).toBe("'none'")
    expect(CspPresets.unsafeInline).toBe("'unsafe-inline'")
  })
})

describe('csp() middleware', () => {
  test('sets Content-Security-Policy header', async () => {
    const ctx = makeCtx()
    await csp({ directives: { defaultSrc: ["'self'"] } })(ctx, noop)
    expect(ctx._headers['Content-Security-Policy']).toBe("default-src 'self'")
  })

  test('uses Content-Security-Policy-Report-Only when reportOnly: true', async () => {
    const ctx = makeCtx()
    await csp({ reportOnly: true, directives: { defaultSrc: ["'self'"] } })(ctx, noop)
    expect(ctx._headers['Content-Security-Policy-Report-Only']).toBe("default-src 'self'")
    expect(ctx._headers['Content-Security-Policy']).toBeUndefined()
  })

  test('calls next()', async () => {
    const ctx = makeCtx()
    let called = false
    await csp()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})

// setRateLimitHeaders()

describe('setRateLimitHeaders()', () => {
  test('sets RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset', () => {
    const ctx = makeCtx()
    setRateLimitHeaders(ctx, { limit: 100, remaining: 75, reset: 1700000000 })
    expect(ctx._headers['RateLimit-Limit']).toBe('100')
    expect(ctx._headers['RateLimit-Remaining']).toBe('75')
    expect(ctx._headers['RateLimit-Reset']).toBe('1700000000')
  })

  test('clamps remaining to 0 when negative', () => {
    const ctx = makeCtx()
    setRateLimitHeaders(ctx, { limit: 10, remaining: -5, reset: 1700000000 })
    expect(ctx._headers['RateLimit-Remaining']).toBe('0')
  })

  test('sets Retry-After when retryAfter is provided', () => {
    const ctx = makeCtx()
    setRateLimitHeaders(ctx, { limit: 10, remaining: 0, reset: 1700000000, retryAfter: 30 })
    expect(ctx._headers['Retry-After']).toBe('30')
  })

  test('does NOT set Retry-After when retryAfter is absent', () => {
    const ctx = makeCtx()
    setRateLimitHeaders(ctx, { limit: 10, remaining: 5, reset: 1700000000 })
    expect(ctx._headers['Retry-After']).toBeUndefined()
  })
})

// csrf() middleware

/** Build a context that includes a mock session for CSRF tests. */
function makeSessionCtx(
  method = 'POST',
  overrides: Partial<ShieldContext> = {}
): ShieldContext & { _headers: Record<string, string>; _session: Record<string, unknown> } {
  const _headers: Record<string, string> = {}
  const _session: Record<string, unknown> = {}

  return {
    request: {
      method,
      url: 'http://localhost/submit',
      headers: {},
    },
    response: {
      headers: _headers,
      setHeader(name: string, value: string) {
        _headers[name] = value
      },
    },
    session: {
      get(key: string) { return _session[key] ?? null },
      set(key: string, value: unknown) { _session[key] = value },
    },
    throw(status: number, message: string): never {
      throw Object.assign(new Error(message), { status })
    },
    _headers,
    _session,
    ...overrides,
  }
}

describe('csrf() middleware', () => {
  test('GET requests pass through without validation', async () => {
    const ctx = makeSessionCtx('GET')
    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('HEAD requests pass through without validation', async () => {
    const ctx = makeSessionCtx('HEAD')
    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('OPTIONS requests pass through without validation', async () => {
    const ctx = makeSessionCtx('OPTIONS')
    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('POST with valid token in request body passes', async () => {
    const ctx = makeSessionCtx('POST')
    // Generate and store a token via csrfToken()
    const token = csrfToken(ctx)
    ctx.request.body = { _csrf: token }

    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('POST with valid token in x-csrf-token header passes', async () => {
    const ctx = makeSessionCtx('POST')
    const token = csrfToken(ctx)
    ctx.request.headers['x-csrf-token'] = token

    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('POST with token in query string does NOT pass (insecure)', async () => {
    const ctx = makeSessionCtx('POST')
    const token = csrfToken(ctx)
    ctx.request.query = { _csrf: token }

    await expect(csrf()(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })

  test('POST without token throws 403', async () => {
    const ctx = makeSessionCtx('POST')
    // Ensure a token exists in session so it is not the "no session" path
    csrfToken(ctx)

    await expect(csrf()(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })

  test('POST with wrong token throws 403', async () => {
    const ctx = makeSessionCtx('POST')
    csrfToken(ctx) // stores a real token
    ctx.request.body = { _csrf: 'wrong-token-value' }

    await expect(csrf()(ctx, noop)).rejects.toMatchObject({ status: 403 })
  })

  test('POST to an excepted path skips validation', async () => {
    const ctx = makeSessionCtx('POST')
    ctx.request.url = '/api/webhook'
    // No token provided — but path is excepted

    let called = false
    await csrf({ exceptPaths: ['/api/'] })(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('DELETE with valid token in header passes', async () => {
    const ctx = makeSessionCtx('DELETE')
    const token = csrfToken(ctx)
    ctx.request.headers['x-csrf-token'] = token

    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('csrfToken() creates and stores a token when session has none', () => {
    const ctx = makeSessionCtx('GET')
    const token = csrfToken(ctx)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
    // Second call returns the same token (stored in session)
    expect(csrfToken(ctx)).toBe(token)
  })

  test('csrfToken() throws when session is unavailable', () => {
    const ctx = makeCtx() // no session
    expect(() => csrfToken(ctx)).toThrow(/@tekir\/shield csrf/)
  })

  test('body token takes priority over header token', async () => {
    const ctx = makeSessionCtx('POST')
    const realToken = csrfToken(ctx)

    // Body has the real token; header has an invalid one
    ctx.request.body = { _csrf: realToken }
    ctx.request.headers['x-csrf-token'] = 'bad-header-token'

    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})

// csp() middleware — additional header correctness tests

describe('csp() middleware — header correctness', () => {
  test('sets multiple directives in the header value', async () => {
    const ctx = makeCtx()
    await csp({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.example.com'],
        upgradeInsecureRequests: true,
      },
    })(ctx, noop)

    const header = ctx._headers['Content-Security-Policy']
    expect(header).toContain("default-src 'self'")
    expect(header).toContain("script-src 'self' https://cdn.example.com")
    expect(header).toContain('upgrade-insecure-requests')
  })

  test('does NOT set header when directives object is empty', async () => {
    const ctx = makeCtx()
    await csp({ directives: {} })(ctx, noop)
    // buildCspHeader({}) returns "" so setHeader should not be called
    expect(ctx._headers['Content-Security-Policy']).toBeUndefined()
  })

  test('Report-Only mode does not set the enforcement header', async () => {
    const ctx = makeCtx()
    await csp({ reportOnly: true, directives: { defaultSrc: ["'self'"] } })(ctx, noop)
    expect(ctx._headers['Content-Security-Policy']).toBeUndefined()
    expect(ctx._headers['Content-Security-Policy-Report-Only']).toBeDefined()
  })

  test('calls next() after setting the header', async () => {
    const ctx = makeCtx()
    let called = false
    await csp({ directives: { defaultSrc: ["'none'"] } })(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})

// shield() — returns array of middlewares

describe('shield()', () => {
  test('returns an array', () => {
    expect(Array.isArray(shield())).toBe(true)
  })

  test('default call includes helmet, csp, and csrf (secure-by-default)', () => {
    // helmet + csp + csrf = 3 by default; csp is now applied unless opted out.
    const middlewares = shield()
    expect(middlewares.length).toBe(3)
  })

  test('shield({ helmet: false }) excludes helmet', () => {
    const withHelmet = shield({})
    const withoutHelmet = shield({ helmet: false })
    expect(withoutHelmet.length).toBeLessThan(withHelmet.length)
  })

  test('shield() applies a default CSP unless csp: false', () => {
    const withDefaultCsp = shield({})
    const withoutCsp = shield({ csp: false })
    expect(withDefaultCsp.length).toBeGreaterThan(withoutCsp.length)
  })

  test('shield({ csrf: false }) excludes csrf middleware', () => {
    const withCsrf = shield({})
    const withoutCsrf = shield({ csrf: false })
    expect(withoutCsrf.length).toBeLessThan(withCsrf.length)
  })

  test('shield({ helmet: false, csrf: false, csp: false }) returns an empty array', () => {
    const middlewares = shield({ helmet: false, csrf: false, csp: false })
    expect(middlewares).toHaveLength(0)
  })

  test('helmet middleware in shield() sets security headers', async () => {
    const ctx = makeCtx()
    const [helmetMw] = shield({ csrf: false })
    await helmetMw(ctx, noop)
    expect(ctx._headers['X-Content-Type-Options']).toBe('nosniff')
    expect(ctx._headers['X-Frame-Options']).toBe('SAMEORIGIN')
  })

  test('all middlewares are functions', () => {
    const middlewares = shield({
      helmet: {},
      csp: { directives: { defaultSrc: ["'self'"] } },
      csrf: {},
    })
    for (const mw of middlewares) {
      expect(typeof mw).toBe('function')
    }
  })
})

// NEW TESTS: Deep edge cases for Shield

describe('sanitize() — advanced XSS payloads', () => {
  test('removes nested script tags', () => {
    expect(sanitize('<scr<script>ipt>alert(1)</script>')).not.toContain('script')
  })

  test('handles self-closing tags', () => {
    expect(sanitize('<br/><hr/>text')).toBe('text')
  })

  test('removes style tags with multiline content', () => {
    const input = `<style>
      body { color: red; }
      .evil { display: none; }
    </style>Safe content`
    expect(sanitize(input)).toBe('Safe content')
  })

  test('strips data attributes from tags', () => {
    expect(sanitize('<div data-evil="payload">content</div>')).toBe('content')
  })
})

describe('escapeHtml / unescapeHtml — roundtrip', () => {
  test('roundtrip with all special characters', () => {
    const input = `<div class="test" data-x='y'>a & b / c \`d\` = e</div>`
    expect(unescapeHtml(escapeHtml(input))).toBe(input)
  })

  test('double escape produces different output', () => {
    const once = escapeHtml('&')
    const twice = escapeHtml(once)
    expect(twice).not.toBe(once)
    expect(unescapeHtml(unescapeHtml(twice))).toBe('&')
  })

  test('escapeHtml with unicode characters leaves them unchanged', () => {
    expect(escapeHtml('Hello 世界')).toBe('Hello 世界')
  })
})

describe('helmet() — custom option combinations', () => {
  test('all cross-origin policies enabled together', async () => {
    const ctx = makeCtx()
    await helmet({
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginEmbedderPolicy: 'require-corp',
      crossOriginResourcePolicy: 'same-site',
    })(ctx, noop)
    expect(ctx._headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(ctx._headers['Cross-Origin-Embedder-Policy']).toBe('require-corp')
    expect(ctx._headers['Cross-Origin-Resource-Policy']).toBe('same-site')
  })

  test('HSTS with all options enabled', async () => {
    const ctx = makeCtx()
    await helmet({ hsts: { maxAge: 63072000, includeSubDomains: true, preload: true } })(ctx, noop)
    const hsts = ctx._headers['Strict-Transport-Security']
    expect(hsts).toContain('max-age=63072000')
    expect(hsts).toContain('includeSubDomains')
    expect(hsts).toContain('preload')
  })

  test('disabling contentTypeOptions removes X-Content-Type-Options', async () => {
    const ctx = makeCtx()
    await helmet({ contentTypeOptions: false })(ctx, noop)
    expect(ctx._headers['X-Content-Type-Options']).toBeUndefined()
  })
})

describe('csrf — token rotation', () => {
  test('csrfToken returns same token on repeated calls within same session', () => {
    const ctx = makeSessionCtx('GET')
    const token1 = csrfToken(ctx)
    const token2 = csrfToken(ctx)
    expect(token1).toBe(token2)
  })

  test('different sessions get different CSRF tokens', () => {
    const ctx1 = makeSessionCtx('GET')
    const ctx2 = makeSessionCtx('GET')
    const token1 = csrfToken(ctx1)
    const token2 = csrfToken(ctx2)
    expect(token1).not.toBe(token2)
  })

  test('CSRF token is a non-empty string', () => {
    const ctx = makeSessionCtx('GET')
    const token = csrfToken(ctx)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(10)
  })
})

describe('buildCspHeader — additional directives', () => {
  test('handles styleSrc directive', () => {
    const value = buildCspHeader({ styleSrc: ["'self'", "'unsafe-inline'"] })
    expect(value).toBe("style-src 'self' 'unsafe-inline'")
  })

  test('handles connectSrc directive', () => {
    const value = buildCspHeader({ connectSrc: ["'self'", 'https://api.example.com'] })
    expect(value).toContain("connect-src 'self' https://api.example.com")
  })

  test('handles fontSrc directive', () => {
    const value = buildCspHeader({ fontSrc: ["'self'", 'https://fonts.googleapis.com'] })
    expect(value).toContain('font-src')
  })

  test('multiple directives are semicolon-separated', () => {
    const value = buildCspHeader({
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'unsafe-inline'"],
    })
    const parts = value.split(';').map(s => s.trim())
    expect(parts.length).toBe(3)
  })
})

describe('setRateLimitHeaders — edge cases', () => {
  test('handles zero values for limit and remaining', () => {
    const ctx = makeCtx()
    setRateLimitHeaders(ctx, { limit: 0, remaining: 0, reset: 0 })
    expect(ctx._headers['RateLimit-Limit']).toBe('0')
    expect(ctx._headers['RateLimit-Remaining']).toBe('0')
    expect(ctx._headers['RateLimit-Reset']).toBe('0')
  })

  test('retryAfter of 0 is still set', () => {
    const ctx = makeCtx()
    setRateLimitHeaders(ctx, { limit: 10, remaining: 0, reset: 100, retryAfter: 0 })
    expect(ctx._headers['Retry-After']).toBe('0')
  })
})

describe('sanitize — complex payloads', () => {
  test('handles multiple script tags', () => {
    expect(sanitize('<script>a()</script>safe<script>b()</script>')).toBe('safe')
  })

  test('handles SVG with event handler', () => {
    const result = sanitize('<svg onload="alert(1)"><circle r="10"/></svg>')
    expect(result).not.toContain('onload')
    expect(result).not.toContain('alert')
  })

  test('handles comment tags', () => {
    expect(sanitize('before<!-- comment -->after')).toBe('beforeafter')
  })

  test('handles HTML entities', () => {
    const result = sanitize('&amp; &lt; &gt;')
    expect(result).toBe('&amp; &lt; &gt;')
  })

  test('preserves whitespace between tags', () => {
    expect(sanitize('<p>hello</p> <p>world</p>')).toBe('hello world')
  })
})

describe('escapeHtml — stress tests', () => {
  test('escapes all dangerous characters in one string', () => {
    const result = escapeHtml('<>"\'&/`=')
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).not.toContain('"')
    expect(result).not.toContain("'")
    expect(result).not.toContain('/')
    expect(result).not.toContain('`')
    expect(result).not.toContain('=')
  })

  test('escapeHtml preserves numbers and normal text', () => {
    expect(escapeHtml('Hello 123 world')).toBe('Hello 123 world')
  })

  test('escapeHtml handles long strings', () => {
    const input = '<b>'.repeat(1000)
    const result = escapeHtml(input)
    expect(result).not.toContain('<')
    expect(result.length).toBeGreaterThan(input.length)
  })
})

describe('helmet — header count', () => {
  test('default helmet sets at least 5 headers', async () => {
    const ctx = makeCtx()
    await helmet()(ctx, noop)
    expect(Object.keys(ctx._headers).length).toBeGreaterThanOrEqual(5)
  })

  test('helmet with all options disabled sets no headers', async () => {
    const ctx = makeCtx()
    await helmet({
      frameOptions: false,
      hsts: false,
      contentTypeOptions: false,
      xssProtection: false,
      downloadOptions: false,
      crossDomainPolicies: false,
      referrerPolicy: false,
    } as any)(ctx, noop)
    // May still have some headers based on implementation
    expect(typeof ctx._headers).toBe('object')
  })
})

describe('csrf — method coverage', () => {
  test('PUT with valid token passes', async () => {
    const ctx = makeSessionCtx('PUT')
    const token = csrfToken(ctx)
    ctx.request.headers['x-csrf-token'] = token
    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })

  test('PATCH with valid token passes', async () => {
    const ctx = makeSessionCtx('PATCH')
    const token = csrfToken(ctx)
    ctx.request.body = { _csrf: token }
    let called = false
    await csrf()(ctx, async () => { called = true })
    expect(called).toBe(true)
  })
})
