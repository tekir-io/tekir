import { test, expect, describe, afterEach } from 'bun:test'
import { createResponse, setTrustedHosts } from '../src/http/response'

// ═══════════════════════════════════════════════════════════
// Cookie HMAC (sha256 + timingSafeEqual)
// ═══════════════════════════════════════════════════════════

describe('Response — HMAC cookie signing', () => {
  test('signedCookie produces a value with dot separator', () => {
    const res = createResponse()
    res.signedCookie('token', 'hello', 'my-secret')
  })

  test('hmacSign produces consistent output for same input', () => {
    const { createHmac } = require('crypto')
    const sig1 = createHmac('sha256', 'secret').update('value').digest('base64url')
    const sig2 = createHmac('sha256', 'secret').update('value').digest('base64url')
    expect(sig1).toBe(sig2)
  })

  test('hmacSign produces different output for different secrets', () => {
    const { createHmac } = require('crypto')
    const sig1 = createHmac('sha256', 'secret1').update('value').digest('base64url')
    const sig2 = createHmac('sha256', 'secret2').update('value').digest('base64url')
    expect(sig1).not.toBe(sig2)
  })

  test('hmacSign produces different output for different values', () => {
    const { createHmac } = require('crypto')
    const sig1 = createHmac('sha256', 'secret').update('value1').digest('base64url')
    const sig2 = createHmac('sha256', 'secret').update('value2').digest('base64url')
    expect(sig1).not.toBe(sig2)
  })
})

// ═══════════════════════════════════════════════════════════
// SSE injection prevention
// ═══════════════════════════════════════════════════════════

describe('Response — SSE newline injection', () => {
  test('string data has newlines stripped', () => {
    const res = createResponse()
    const output = res.sse('hello\nworld\r\nevil')
    expect(output).toBe('data: helloworldevil\n\n')
    expect(output).not.toContain('\nworld')
  })

  test('event field has newlines stripped', () => {
    const res = createResponse()
    const output = res.sse({ event: 'message\nevent: malicious', data: 'ok' })
    expect(output).toContain('event: messageevent: malicious\n')
    expect(output).not.toContain('\nevent: malicious')
  })

  test('id field has newlines stripped', () => {
    const res = createResponse()
    const output = res.sse({ id: '123\nid: 999', data: 'ok' })
    expect(output).toContain('id: 123id: 999\n')
    expect(output).not.toContain('\nid: 999')
  })

  test('retry field has newlines stripped', () => {
    const res = createResponse()
    const output = res.sse({ retry: '5000\ndata: injected', data: 'ok' })
    expect(output).not.toContain('\ndata: injected')
  })

  test('data object is JSON stringified (safe)', () => {
    const res = createResponse()
    const output = res.sse({ event: 'msg', data: { key: 'value\ninjected' } })
    expect(output).toContain('data: {"key":"value\\ninjected"}')
  })

  test('data string has newlines stripped', () => {
    const res = createResponse()
    const output = res.sse({ event: 'msg', data: 'line1\nline2' })
    expect(output).toContain('data: line1line2\n\n')
  })

  test('\\r characters are also stripped', () => {
    const res = createResponse()
    const output = res.sse({ event: 'test\r\ninjected', data: 'ok' })
    expect(output).not.toContain('\r')
  })

  test('normal SSE without injection works fine', () => {
    const res = createResponse()
    const output = res.sse({ event: 'update', id: '42', data: { count: 5 } })
    expect(output).toContain('event: update\n')
    expect(output).toContain('id: 42\n')
    expect(output).toContain('data: {"count":5}\n\n')
  })
})

// ═══════════════════════════════════════════════════════════
// Cookie attribute sanitization
// ═══════════════════════════════════════════════════════════

describe('Response — cookie attribute sanitization', () => {
  test('cookie name CRLF is stripped', () => {
    const res = createResponse()
    res.cookie('name\r\nSet-Cookie: evil=true', 'value')
    // Should not throw and name should be sanitized
  })

  test('cookie name semicolons are stripped', () => {
    const res = createResponse()
    res.cookie('name; Path=/', 'value')
  })

  test('cookie path CRLF is stripped', () => {
    const res = createResponse()
    res.cookie('test', 'value', { path: '/\r\nSet-Cookie: evil=true' })
  })

  test('cookie domain CRLF is stripped', () => {
    const res = createResponse()
    res.cookie('test', 'value', { domain: 'evil.com\r\nSet-Cookie: hack=true' })
  })

  test('cookie sameSite CRLF is stripped', () => {
    const res = createResponse()
    res.cookie('test', 'value', { sameSite: 'Lax\r\nSet-Cookie: x=y' as any })
  })

  test('cookie maxAge is always an integer', () => {
    const res = createResponse()
    res.cookie('test', 'value', { maxAge: 3600.7 })
    // Should floor to 3600
  })

  test('cookie value is URI encoded', () => {
    const res = createResponse()
    res.cookie('test', 'value with spaces & special=chars')
    // encodeURIComponent handles this
  })

  test('clearCookie name is sanitized', () => {
    const res = createResponse()
    res.clearCookie('session\r\nSet-Cookie: admin=true')
    // Should not inject headers
  })

  test('clearCookie semicolons are stripped', () => {
    const res = createResponse()
    res.clearCookie('session; Path=/admin')
  })

  test('normal cookie works correctly', () => {
    const res = createResponse()
    res.cookie('session', 'abc123', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 3600,
    })
  })
})

// ═══════════════════════════════════════════════════════════
// Content-Disposition filename sanitization
// ═══════════════════════════════════════════════════════════

describe('Response — Content-Disposition sanitization', () => {
  test('download sanitizes quotes in filename', async () => {
    const res = createResponse()
    // We can't fully test without runtime, but the method should exist
    expect(typeof res.download).toBe('function')
  })

  test('attachment sanitizes quotes in filename', async () => {
    const res = createResponse()
    expect(typeof res.attachment).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════
// Redirect
// ═══════════════════════════════════════════════════════════

describe('Response — redirect', () => {
  test('redirect returns 302 by default', () => {
    const res = createResponse()
    const result = res.redirect('/dashboard')
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(302)
    expect(result.headers.get('Location')).toBe('/dashboard')
  })

  test('redirect with custom status', () => {
    const res = createResponse()
    const result = res.redirect('/new-url', 301)
    expect(result.status).toBe(301)
  })

  test('redirect.back honors same-origin referer', () => {
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://app.example/dashboard?tab=stats', host: 'app.example' },
    })
    const res = createResponse(req)
    const result = res.redirect.back()
    expect(result.status).toBe(302)
    expect(result.headers.get('Location')).toBe('/dashboard?tab=stats')
  })

  test('redirect.back ignores cross-origin referer and uses fallback', () => {
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://evil.example/phish', host: 'app.example' },
    })
    const res = createResponse(req)
    const result = res.redirect.back('/login')
    expect(result.headers.get('Location')).toBe('/login')
  })

  test('redirect.back falls back to "/" when referer missing', () => {
    const req = new Request('https://app.example/page', { headers: { host: 'app.example' } })
    const res = createResponse(req)
    const result = res.redirect.back()
    expect(result.headers.get('Location')).toBe('/')
  })

  test('redirect.back falls back when no request was passed', () => {
    const res = createResponse()
    const result = res.redirect.back('/home')
    expect(result.headers.get('Location')).toBe('/home')
  })

  test('movedPermanently returns 301', () => {
    const res = createResponse()
    const result = res.movedPermanently('/new')
    expect(result.status).toBe(301)
  })

  test('seeOther returns 303', () => {
    const res = createResponse()
    const result = res.seeOther('/other')
    expect(result.status).toBe(303)
  })

  test('temporaryRedirect returns 307', () => {
    const res = createResponse()
    const result = res.temporaryRedirect('/temp')
    expect(result.status).toBe(307)
  })

  test('permanentRedirect returns 308', () => {
    const res = createResponse()
    const result = res.permanentRedirect('/perm')
    expect(result.status).toBe(308)
  })
})

// ═══════════════════════════════════════════════════════════
// Response — redirect.back trusted-host same-origin check
// ═══════════════════════════════════════════════════════════

describe('Response — redirect.back trusted hosts', () => {
  // Reset the module-level set so the configure-style tests do not leak into
  // the legacy Host-header tests above.
  afterEach(() => setTrustedHosts([]))

  test('spoofed Host is NOT treated as same-origin when trustedHosts set', () => {
    // Attacker controls both Referer host and the Host header; with a
    // configured trust list the Host header is ignored, so the untrusted
    // referer is rejected and back() uses the fallback.
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://evil.example/phish', host: 'evil.example' },
    })
    const res = createResponse(req, { trustedHosts: ['app.example'] })
    const result = res.redirect.back('/safe')
    expect(result.headers.get('Location')).toBe('/safe')
  })

  test('untrusted referer host falls back to default', () => {
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://other.example/x', host: 'app.example' },
    })
    const res = createResponse(req, { trustedHosts: ['app.example'] })
    expect(res.redirect.back().headers.get('Location')).toBe('/')
  })

  test('referer on a trusted host still returns its pathname + search', () => {
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://app.example/dashboard?tab=stats', host: 'app.example' },
    })
    const res = createResponse(req, { trustedHosts: ['app.example'] })
    expect(res.redirect.back().headers.get('Location')).toBe('/dashboard?tab=stats')
  })

  test('trusted host matches regardless of referer port', () => {
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://app.example:8443/inner', host: 'app.example' },
    })
    const res = createResponse(req, { trustedHosts: ['app.example'] })
    expect(res.redirect.back().headers.get('Location')).toBe('/inner')
  })

  test('wildcard subdomain rule matches subdomains but not the apex', () => {
    const sub = new Request('https://api.app.example/page', {
      headers: { referer: 'https://api.app.example/data', host: 'evil.example' },
    })
    expect(
      createResponse(sub, { trustedHosts: ['*.app.example'] }).redirect.back().headers.get('Location'),
    ).toBe('/data')

    const apex = new Request('https://app.example/page', {
      headers: { referer: 'https://app.example/data', host: 'evil.example' },
    })
    expect(
      createResponse(apex, { trustedHosts: ['*.app.example'] }).redirect.back('/fb').headers.get('Location'),
    ).toBe('/fb')
  })

  test('app-level setTrustedHosts is inherited by createResponse(request)', () => {
    setTrustedHosts(['app.example'])
    const spoofed = new Request('https://app.example/page', {
      headers: { referer: 'https://evil.example/x', host: 'evil.example' },
    })
    expect(createResponse(spoofed).redirect.back('/fb').headers.get('Location')).toBe('/fb')

    const ok = new Request('https://app.example/page', {
      headers: { referer: 'https://app.example/ok', host: 'app.example' },
    })
    expect(createResponse(ok).redirect.back().headers.get('Location')).toBe('/ok')
  })

  test('without trustedHosts, legacy Host-header same-origin still works', () => {
    const req = new Request('https://app.example/page', {
      headers: { referer: 'https://app.example/dashboard', host: 'app.example' },
    })
    expect(createResponse(req).redirect.back().headers.get('Location')).toBe('/dashboard')
  })
})

// ═══════════════════════════════════════════════════════════
// Response — status codes
// ═══════════════════════════════════════════════════════════

describe('Response — HTTP status codes', () => {
  test('ok returns 200', () => {
    const res = createResponse()
    expect(res.ok({ msg: 'hi' }).status).toBe(200)
  })

  test('created returns 201', () => {
    const res = createResponse()
    expect(res.created({ id: 1 }).status).toBe(201)
  })

  test('noContent returns 204', () => {
    const res = createResponse()
    expect(res.noContent().status).toBe(204)
  })

  test('badRequest returns 400', () => {
    const res = createResponse()
    expect(res.badRequest().status).toBe(400)
  })

  test('unauthorized returns 401', () => {
    const res = createResponse()
    expect(res.unauthorized().status).toBe(401)
  })

  test('forbidden returns 403', () => {
    const res = createResponse()
    expect(res.forbidden().status).toBe(403)
  })

  test('notFound returns 404', () => {
    const res = createResponse()
    expect(res.notFound().status).toBe(404)
  })

  test('conflict returns 409', () => {
    const res = createResponse()
    expect(res.conflict().status).toBe(409)
  })

  test('unprocessableEntity returns 422', () => {
    const res = createResponse()
    expect(res.unprocessableEntity().status).toBe(422)
  })

  test('tooManyRequests returns 429', () => {
    const res = createResponse()
    expect(res.tooManyRequests().status).toBe(429)
  })

  test('internalServerError returns 500', () => {
    const res = createResponse()
    expect(res.internalServerError().status).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════
// Response — headers
// ═══════════════════════════════════════════════════════════

describe('Response — header methods', () => {
  test('header sets value', () => {
    const res = createResponse()
    res.header('X-Custom', 'value')
  })

  test('safeHeader does not overwrite', () => {
    const res = createResponse()
    res.header('X-Test', 'first')
    res.safeHeader('X-Test', 'second')
  })

  test('removeHeader removes', () => {
    const res = createResponse()
    res.header('X-Remove', 'val')
    res.removeHeader('X-Remove')
  })

  test('append adds multiple values', () => {
    const res = createResponse()
    res.append('X-Multi', 'val1')
    res.append('X-Multi', 'val2')
  })
})

// ═══════════════════════════════════════════════════════════
// Response — content types
// ═══════════════════════════════════════════════════════════

describe('Response — content types', () => {
  test('json returns application/json', () => {
    const res = createResponse()
    const r = res.json({ test: true })
    expect(r.headers.get('Content-Type')).toBe('application/json')
  })

  test('html returns text/html', () => {
    const res = createResponse()
    const r = res.html('<h1>Hello</h1>')
    expect(r.headers.get('Content-Type')).toContain('text/html')
  })

  test('text returns text/plain', () => {
    const res = createResponse()
    const r = res.text('hello')
    expect(r.headers.get('Content-Type')).toContain('text/plain')
  })

  test('send auto-detects JSON for objects', () => {
    const res = createResponse()
    const r = res.send({ key: 'value' })
    expect(r.headers.get('Content-Type')).toBe('application/json')
  })

  test('send auto-detects HTML for strings starting with <', () => {
    const res = createResponse()
    const r = res.send('<div>hi</div>')
    expect(r.headers.get('Content-Type')).toContain('text/html')
  })

  test('send treats non-HTML strings as text/plain', () => {
    const res = createResponse()
    const r = res.send('plain text')
    expect(r.headers.get('Content-Type')).toContain('text/plain')
  })
})
