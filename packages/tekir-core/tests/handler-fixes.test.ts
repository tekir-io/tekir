import { test, expect, describe } from 'bun:test'
import { TekirServer } from '../src/server/server'

function createServer() {
  const server = new TekirServer()
  const router = server.getRouter()
  return { server, router }
}

describe('Body parser — graceful failure', () => {
  test('empty body with application/json header sets ctx.bodyError instead of crashing', async () => {
    const { server, router } = createServer()
    router.post('/x', ({ body, bodyError }: any) => {
      if (bodyError) return Response.json({ ok: false, code: 'INVALID_BODY' }, { status: 400 })
      return { ok: true, body }
    })

    const res = await server.handle(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // no body — Bun's Request.json() throws on empty payload
    }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, code: 'INVALID_BODY' })
  })

  test('valid JSON body parses normally and bodyError is undefined', async () => {
    const { server, router } = createServer()
    router.post('/x', ({ body, bodyError }: any) => ({
      hadError: bodyError != null,
      body,
    }))

    const res = await server.handle(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hadError: false, body: { a: 1 } })
  })

  test('malformed JSON sets bodyError', async () => {
    const { server, router } = createServer()
    router.post('/x', ({ bodyError }: any) => ({
      err: bodyError ? 'caught' : 'none',
    }))

    const res = await server.handle(new Request('http://x/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    }))

    expect(await res.json()).toEqual({ err: 'caught' })
  })
})

describe('response.status() — stateful', () => {
  test('status(500) carries through to json()', async () => {
    const { server, router } = createServer()
    router.get('/err', ({ response }: any) => response.status(500).json({ message: 'boom' }))

    const res = await server.handle(new Request('http://x/err'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'boom' })
  })

  test('status(418) carries through to text()', async () => {
    const { server, router } = createServer()
    router.get('/teapot', ({ response }: any) => response.status(418).text("I'm a teapot"))

    const res = await server.handle(new Request('http://x/teapot'))
    expect(res.status).toBe(418)
    expect(await res.text()).toBe("I'm a teapot")
  })

  test('routes that do not use response.status are unaffected', async () => {
    const { server, router } = createServer()
    router.get('/plain', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/plain'))
    expect(res.status).toBe(200)
  })
})

describe('Middleware — return value capture', () => {
  test('middleware returning a Response sets it as the result', async () => {
    const { server, router } = createServer()
    router.useGlobal(async () => {
      return new Response('blocked', { status: 401 })
    })
    router.get('/gated', () => ({ secret: true }))

    const res = await server.handle(new Request('http://x/gated'))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('blocked')
  })

  test('middleware returning undefined falls through to handler', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (_ctx, next) => {
      await next()
    })
    router.get('/open', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/open'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('explicit ctx.$result still wins over later return', async () => {
    const { server, router } = createServer()
    router.useGlobal(async (ctx: any) => {
      ctx.$result = new Response('explicit', { status: 403 })
      return new Response('return', { status: 418 })
    })
    router.get('/x', () => ({ ok: true }))

    const res = await server.handle(new Request('http://x/x'))
    expect(res.status).toBe(403)
    expect(await res.text()).toBe('explicit')
  })
})

describe('Bun.serve fallback routing', () => {
  test('uses native catch-all route for synthetic fallback on plain HTTP apps', () => {
    const originalServe = Bun.serve
    const originalGc = Bun.gc
    let capturedConfig: any

    Bun.serve = ((config: any) => {
      capturedConfig = config
      return { stop() {} }
    }) as any
    Bun.gc = (() => {}) as any

    try {
      const { server, router } = createServer()
      router.get('/x', () => ({ ok: true }))

      server.start()

      expect(capturedConfig.fetch).toBeUndefined()
      expect(typeof capturedConfig.routes['/*']).toBe('function')
    } finally {
      Bun.serve = originalServe
      Bun.gc = originalGc
    }
  })

  test('keeps fetch fallback when a custom fallback is registered', async () => {
    const originalServe = Bun.serve
    const originalGc = Bun.gc
    let capturedConfig: any

    Bun.serve = ((config: any) => {
      capturedConfig = config
      return { stop() {} }
    }) as any
    Bun.gc = (() => {}) as any

    try {
      const { server, router } = createServer()
      router.get('/api', () => ({ ok: true }))
      server.fallback(() => new Response('frontend'))

      server.start()

      expect(typeof capturedConfig.fetch).toBe('function')
      expect(capturedConfig.routes['/*']).toBeUndefined()

      const res = await capturedConfig.fetch(new Request('http://x/spa'), {})
      expect(await res.text()).toBe('frontend')
    } finally {
      Bun.serve = originalServe
      Bun.gc = originalGc
    }
  })
})
