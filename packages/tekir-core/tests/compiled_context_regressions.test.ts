import { describe, expect, test } from 'bun:test'
import { TekirServer } from '../src/server/server'
import { createRequest, getRequestCookie } from '../src/http/request'
import { createResponse } from '../src/http/response'

function server() {
  const instance = new TekirServer()
  return { instance, router: instance.getRouter() }
}

describe('compiled context contract', () => {
  test('delegating the whole context preserves the response builder', async () => {
    const { instance, router } = server()
    const login = (ctx: any) => {
      ctx.response.cookie('token', 'abc')
      return ctx.response.ok({ ok: true })
    }
    router.get('/login', (ctx: any) => login(ctx))

    const response = await instance.handle(new Request('http://x/login'))
    expect(response.headers.get('Set-Cookie')).toContain('token=abc')
  })

  test('compiled request exposes all(), headers(), params() and route matching', async () => {
    const { instance, router } = server()
    router.post('/items/:id', ({ request }: any) => ({
      all: request.all(),
      header: request.headers()['x-test'],
      params: request.params(),
      route: request.matchesRoute('items.store'),
    })).as('items.store')

    const response = await instance.handle(new Request('http://x/items/7?q=yes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test': 'ok' },
      body: JSON.stringify({ name: 'tekir' }),
    }))
    expect(await response.json()).toEqual({
      all: { q: 'yes', name: 'tekir' },
      header: 'ok',
      params: { id: '7' },
      route: true,
    })
  })

  test('request input rejects inherited prototype keys on the compiled path', async () => {
    const { instance, router } = server()
    router.post('/input', ({ request }: any) => ({
      constructor: request.input('constructor', 'safe'),
      prototype: request.input('__proto__', 'safe'),
    }))
    const response = await instance.handle(new Request('http://x/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }))
    expect(await response.json()).toEqual({ constructor: 'safe', prototype: 'safe' })
  })
})

describe('response state finalization', () => {
  test('middleware cookies and headers apply to a plain handler result', async () => {
    const { instance, router } = server()
    router.useGlobal(async ({ response }: any, next) => {
      response.cookie('session', 'abc').header('X-Middleware', 'yes')
      await next()
    })
    router.get('/plain', () => ({ ok: true }))

    const response = await instance.handle(new Request('http://x/plain'))
    expect(response.headers.get('Set-Cookie')).toContain('session=abc')
    expect(response.headers.get('X-Middleware')).toBe('yes')
  })

  test('stream and wrapped Response preserve staged state', async () => {
    const first = createResponse()
    first.cookie('stream', '1')
    const streamResponse = first.stream(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('ok'))
        controller.close()
      },
    }))
    expect(streamResponse.headers.get('Set-Cookie')).toContain('stream=1')

    const second = createResponse()
    second.cookie('wrapped', '1').header('X-Wrapped', 'yes')
    const wrapped = second.send(new Response('ok'))
    expect(wrapped.headers.get('Set-Cookie')).toContain('wrapped=1')
    expect(wrapped.headers.get('X-Wrapped')).toBe('yes')
  })

  test('onFinish callbacks execute once', async () => {
    const builder = createResponse()
    let calls = 0
    builder.onFinish(() => { calls++ })
    builder.ok({ ok: true })
    await Promise.resolve()
    expect(calls).toBe(1)
  })
})

describe('error pipeline and instance isolation', () => {
  test('custom error handlers and exception reporters are connected', async () => {
    const { instance, router } = server()
    let reports = 0
    instance.getExceptionHandler().report(() => { reports++ })
    instance.errorHandler((_error, ctx) => ctx.response.status(418).text('custom'))
    router.get('/boom', () => { throw new Error('boom') })

    const response = await instance.handle(new Request('http://x/boom'))
    expect(response.status).toBe(418)
    expect(await response.text()).toBe('custom')
    // A handled error does not fall through to the default reporter.
    expect(reports).toBe(0)
  })

  test('unhandled errors run reporters and do not escape handle()', async () => {
    const { instance, router } = server()
    let reports = 0
    instance.getExceptionHandler().report(() => { reports++ })
    router.get('/boom', () => { throw new Error('boom') })

    const response = await instance.handle(new Request('http://x/boom'))
    expect(response.status).toBe(500)
    expect(reports).toBe(1)
  })

  test('development mode does not leak across server instances', async () => {
    new TekirServer().configure({ development: true })
    const production = new TekirServer()
    production.use(async (_ctx, next) => next())
    production.getRouter().get('/boom', () => { throw new Error('secret-detail') })

    const response = await production.handle(new Request('http://x/boom'))
    expect(await response.text()).not.toContain('secret-detail')
  })

  test('trusted hosts remain scoped to their server', async () => {
    const first = new TekirServer().configure({ trustedHosts: ['first.example'] })
    first.getRouter().get('/back', ({ response }: any) => response.redirect.back('/fallback'))
    new TekirServer().configure({ trustedHosts: ['second.example'] })

    const response = await first.handle(new Request('http://first.example/back', {
      headers: { host: 'first.example', referer: 'http://first.example/dashboard' },
    }))
    expect(response.headers.get('Location')).toBe('/dashboard')
  })
})

describe('cookie and body parsing edge cases', () => {
  test('signed cookies round-trip percent characters', () => {
    const builder = createResponse()
    builder.signedCookie('signed', '100%', 'secret')
    const setCookie = builder.ok().headers.get('Set-Cookie')!
    const cookie = setCookie.split(';', 1)[0]
    const request = createRequest(new Request('http://x', { headers: { cookie } }), {})
    expect(request.signedCookie('signed', 'secret')).toBe('100%')
  })

  test('compiled signedCookie reads the standard Cookie header', async () => {
    const builder = createResponse()
    builder.signedCookie('signed', 'value', 'secret')
    const cookie = builder.ok().headers.get('Set-Cookie')!.split(';', 1)[0]
    const { instance, router } = server()
    router.get('/cookie', ({ request }: any) => ({ value: request.signedCookie('signed', 'secret') }))
    const response = await instance.handle(new Request('http://x/cookie', { headers: { cookie } }))
    expect(await response.json()).toEqual({ value: 'value' })
  })

  for (const contentType of ['application/problem+json', 'application/vnd.api+json', 'Application/JSON']) {
    test(`parses ${contentType}`, async () => {
      const { instance, router } = server()
      router.post('/json', ({ body }: any) => body)
      const response = await instance.handle(new Request('http://x/json', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: '{"ok":true}',
      }))
      expect(await response.json()).toEqual({ ok: true })
    })
  }

  test('multipart files remain visible in the compiled context', async () => {
    const form = new FormData()
    form.set('title', 'test')
    form.set('avatar', new File(['abc'], 'avatar.txt'))
    const { instance, router } = server()
    router.post('/upload', (ctx: any) => ({ fields: ctx.body, files: ctx._rawFiles.length }))
    const response = await instance.handle(new Request('http://x/upload', { method: 'POST', body: form }))
    expect(await response.json()).toEqual({ fields: { title: 'test' }, files: 1 })
  })

  test('top-level cookies exposes the documented get contract', async () => {
    const { instance, router } = server()
    router.get('/cookie', ({ cookies }: any) => ({ value: cookies.get('session') }))
    const response = await instance.handle(new Request('http://x/cookie', {
      headers: { cookie: 'session=abc' },
    }))
    expect(await response.json()).toEqual({ value: 'abc' })
    expect(getRequestCookie(new Request('http://x'), 'missing')).toBeNull()
  })
})
