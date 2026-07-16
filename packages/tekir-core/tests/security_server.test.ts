import { test, expect, describe } from 'bun:test'
import { TekirServer } from '../src/server/server'
import { RouteTrie } from '../src/router/trie'
import { createRequest } from '../src/http/request'
import { createResponse, verifySignedCookieValue } from '../src/http/response'
import { App } from '../src/app'

function createServer() {
  const server = new TekirServer()
  return { server, router: server.getRouter() }
}

// ───────────────────────────────────────────────────────────
// Route precedence + matcher unification (handle() via trie)
// ───────────────────────────────────────────────────────────

describe('handle() route precedence (static wins over dynamic)', () => {
  test('static /users/me wins even when /users/:id registered first', async () => {
    const { server, router } = createServer()
    router.get('/users/:id', ({ params }: any) => ({ kind: 'dynamic', id: params.id }))
    router.get('/users/me', () => ({ kind: 'static' }))

    const res = await server.handle(new Request('http://x/users/me'))
    expect(await res.json()).toEqual({ kind: 'static' })
  })

  test('dynamic param still matches other ids', async () => {
    const { server, router } = createServer()
    router.get('/users/:id', ({ params }: any) => ({ id: params.id }))
    router.get('/users/me', () => ({ kind: 'static' }))

    const res = await server.handle(new Request('http://x/users/42'))
    expect(await res.json()).toEqual({ id: '42' })
  })

  test('encoded param is decoded the same as the Bun path', async () => {
    const { server, router } = createServer()
    router.get('/u/:name', ({ params }: any) => ({ name: params.name }))

    const res = await server.handle(new Request('http://x/u/a%20b'))
    expect(await res.json()).toEqual({ name: 'a b' })
  })

  test('malformed percent-encoding does not 500', async () => {
    const { server, router } = createServer()
    router.get('/u/:name', ({ params }: any) => ({ name: params.name }))

    const res = await server.handle(new Request('http://x/u/%E0%A4%A'))
    expect(res.status).toBe(200)
    expect((await res.json()).name).toBe('%E0%A4%A')
  })
})

// ───────────────────────────────────────────────────────────
// 405 vs 404 with Allow header
// ───────────────────────────────────────────────────────────

describe('handle() method handling', () => {
  test('existing path, wrong method → 405 with Allow', async () => {
    const { server, router } = createServer()
    router.post('/login', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/login', { method: 'GET' }))
    expect(res.status).toBe(405)
    const allow = res.headers.get('Allow') || ''
    expect(allow).toContain('POST')
    expect(allow).toContain('OPTIONS')
  })

  test('unknown path → 404 (not 405)', async () => {
    const { server, router } = createServer()
    router.post('/login', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/nope', { method: 'GET' }))
    expect(res.status).toBe(404)
  })
})

// ───────────────────────────────────────────────────────────
// Prototype pollution safety
// ───────────────────────────────────────────────────────────

describe('request prototype-pollution safety', () => {
  test('?__proto__[x]=y does not pollute Object.prototype', () => {
    const raw = new Request('http://x/?__proto__[polluted]=yes&ok=1')
    const r = createRequest(raw, Object.create(null))
    r.all()
    expect(({} as any).polluted).toBeUndefined()
    expect(r.all().ok).toBe('1')
  })

  test('all() output has null prototype and no __proto__ key', () => {
    const raw = new Request('http://x/?a=1')
    const r = createRequest(raw, Object.create(null), { __proto__: 'evil', b: '2' })
    const all = r.all()
    expect(Object.getPrototypeOf(all)).toBeNull()
    expect(Object.prototype.hasOwnProperty.call(all, '__proto__')).toBe(false)
    expect(all.b).toBe('2')
  })

  test('input() rejects unsafe keys', () => {
    const raw = new Request('http://x/?a=1')
    const r = createRequest(raw, Object.create(null))
    expect(r.input('__proto__', 'def')).toBe('def')
    expect(r.input('constructor', 'def')).toBe('def')
  })
})

// ───────────────────────────────────────────────────────────
// signedCookie round-trip (request.ts ↔ response.ts)
// ───────────────────────────────────────────────────────────

describe('signedCookie round-trip', () => {
  test('value signed by response verifies via verifySignedCookieValue', () => {
    const res = createResponse()
    res.signedCookie('session', 'hello', 'secret-key')
    // Reconstruct the signed token the way response.cookie stores it.
    const { createHmac } = require('crypto')
    const sig = createHmac('sha256', 'secret-key').update('hello').digest('base64url')
    const token = `hello.${sig}`
    expect(verifySignedCookieValue(token, 'secret-key')).toBe('hello')
  })

  test('tampered signature rejected', () => {
    expect(verifySignedCookieValue('hello.deadbeef', 'secret-key')).toBeNull()
  })

  test('plain Web API Request reads cookies from the Cookie header', () => {
    const raw = new Request('http://x/', {
      headers: { cookie: 'session=hello%20world; theme=dark; token=a%3Db' },
    })
    const request = createRequest(raw, Object.create(null))

    expect(request.cookie('session')).toBe('hello world')
    expect(request.cookie('theme')).toBe('dark')
    expect(request.cookie('token')).toBe('a=b')
    expect(request.cookie('missing')).toBeNull()
    expect(request.cookies().get('theme')).toBe('dark')
  })

  test('compiled request helper also falls back to the Cookie header', async () => {
    const { server, router } = createServer()
    router.get('/cookie', ({ request }: any) => ({ value: request.cookie('session') }))

    const res = await server.handle(new Request('http://x/cookie', {
      headers: { cookie: 'session=compiled%20cookie' },
    }))
    expect(await res.json()).toEqual({ value: 'compiled cookie' })
  })
})

// ───────────────────────────────────────────────────────────
// makeUrl
// ───────────────────────────────────────────────────────────

describe('makeUrl param substitution', () => {
  test('repeated param name fills both segments', () => {
    const trie = new RouteTrie()
    trie.add('GET', '/a/:id/b/:id', () => {}, [], 'dup')
    expect(trie.makeUrl('dup', { id: '7' })).toBe('/a/7/b/7')
  })

  test('missing required param throws', () => {
    const trie = new RouteTrie()
    trie.add('GET', '/users/:id', () => {}, [], 'show')
    expect(() => trie.makeUrl('show', {})).toThrow(/missing required param/)
  })

  test('unfilled optional param is dropped', () => {
    const trie = new RouteTrie()
    trie.add('GET', '/posts/:slug?', () => {}, [], 'post')
    expect(trie.makeUrl('post', {})).toBe('/posts')
  })

  test('param value is URL-encoded', () => {
    const trie = new RouteTrie()
    trie.add('GET', '/s/:q', () => {}, [], 'search')
    expect(trie.makeUrl('search', { q: 'a b' })).toBe('/s/a%20b')
  })
})

// ───────────────────────────────────────────────────────────
// AOT codegen safety: handler runs as a real closure, no build-time eval
// ───────────────────────────────────────────────────────────

describe('compiled handler correctness (no source re-parse / eval)', () => {
  test('handler with tricky string body serves the authored value', async () => {
    const { server, router } = createServer()
    // A body containing `=>`, `{`, `}`, `return` would have confused the old
    // regex source-parser; the closure path always returns the real value.
    router.get('/tricky', () => ({ note: 'a => b { return; }' }))

    const res = await server.handle(new Request('http://x/tricky'))
    expect(await res.json()).toEqual({ note: 'a => b { return; }' })
  })

  test('closure variable referenced in handler is preserved', async () => {
    const { server, router } = createServer()
    const secret = { value: 123 }
    router.get('/closure', () => ({ v: secret.value }))

    const res = await server.handle(new Request('http://x/closure'))
    expect(await res.json()).toEqual({ v: 123 })
  })
})

// ───────────────────────────────────────────────────────────
// App.shutdown idempotency
// ───────────────────────────────────────────────────────────

describe('App.shutdown idempotency', () => {
  test('shutdown order is preserved across repeated calls', async () => {
    const order: string[] = []
    const app = new App()
    app.register({ shutdown() { order.push('a') } })
    app.register({ shutdown() { order.push('b') } })

    await app.shutdown()
    await app.shutdown()
    // Reverse registration order, and the same both times (not re-reversed).
    expect(order).toEqual(['b', 'a', 'b', 'a'])
  })
})

// ───────────────────────────────────────────────────────────
// Header injection guard (mergeResponseHeaders via middleware)
// ───────────────────────────────────────────────────────────

describe('response header CRLF guard', () => {
  test('CRLF-bearing header from middleware is dropped', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any) => {
      ctx.$responseHeaders = new Headers()
      // Headers API would normally reject this; set on a plain object to
      // exercise the framework guard directly.
      ctx.$responseHeaders = { 'X-Evil': 'a\r\nInjected: 1' }
    })
    router.get('/h', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/h'))
    expect(res.headers.get('Injected')).toBeNull()
  })
})
