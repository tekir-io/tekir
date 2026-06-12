import { test, expect, describe } from 'bun:test'
import { bodyParser } from '../src/middleware'

function createRequest(body: string, contentType = 'application/json', method = 'POST', url = 'http://localhost/test', extraHeaders: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': contentType, ...extraHeaders },
    body,
  })
}

function createCtx(request: Request) {
  const ctx: any = {
    request,
    body: undefined,
    rawBody: undefined,
    response: {
      _status: 200,
      status(code: number) { ctx.response._status = code; return ctx.response },
    },
  }
  return ctx
}

async function run(config: any, request: Request) {
  const ctx = createCtx(request)
  const mw = bodyParser(config)
  let nextCalled = false
  await mw(ctx, async () => { nextCalled = true })
  return { ctx, nextCalled }
}

describe('JSON prototype-pollution filtering', () => {
  test('top-level __proto__ key is stripped', async () => {
    const req = createRequest('{"__proto__":{"polluted":true},"safe":1}')
    const { ctx } = await run({}, req)
    expect(ctx.body.safe).toBe(1)
    expect(Object.prototype.hasOwnProperty.call(ctx.body, '__proto__')).toBe(false)
    // Global prototype must remain clean.
    expect(({} as any).polluted).toBeUndefined()
  })

  test('nested __proto__ / constructor / prototype keys are stripped', async () => {
    const req = createRequest(JSON.stringify({
      user: { __proto__: { admin: true }, name: 'x' },
      meta: { constructor: { bad: 1 }, prototype: { worse: 2 }, ok: 'yes' },
    }))
    const { ctx } = await run({}, req)
    expect(ctx.body.user.name).toBe('x')
    expect(ctx.body.meta.ok).toBe('yes')
    expect(Object.prototype.hasOwnProperty.call(ctx.body.user, '__proto__')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(ctx.body.meta, 'constructor')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(ctx.body.meta, 'prototype')).toBe(false)
    expect(({} as any).admin).toBeUndefined()
  })

  test('proto keys inside arrays are stripped', async () => {
    const req = createRequest('{"items":[{"__proto__":{"x":1},"id":1}]}')
    const { ctx } = await run({}, req)
    expect(ctx.body.items[0].id).toBe(1)
    expect(Object.prototype.hasOwnProperty.call(ctx.body.items[0], '__proto__')).toBe(false)
  })

  test('legitimate data is preserved', async () => {
    const req = createRequest('{"name":"Ali","nested":{"a":1,"b":[1,2,3]}}')
    const { ctx } = await run({}, req)
    expect(ctx.body).toEqual({ name: 'Ali', nested: { a: 1, b: [1, 2, 3] } })
  })
})

describe('JSON/form size limit enforced before full buffering', () => {
  test('oversized JSON rejected via Content-Length pre-check', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(5000) })
    const req = createRequest(big, 'application/json', 'POST', 'http://localhost/test', {
      'content-length': String(Buffer.byteLength(big)),
    })
    const { ctx } = await run({ json: { limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
    expect(ctx.body).toEqual({ error: 'Payload Too Large' })
  })

  test('oversized JSON without Content-Length is aborted during streaming', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(5000) })
    // Build a streaming request so Content-Length is not set up-front.
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode(big)); c.close() },
    })
    const req = new Request('http://localhost/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      // @ts-expect-error duplex is required for streaming request bodies
      duplex: 'half',
    })
    const { ctx } = await run({ json: { limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
  })

  test('within-limit JSON still parses', async () => {
    const req = createRequest('{"ok":true}', 'application/json')
    const { ctx } = await run({ json: { limit: '1mb' } }, req)
    expect(ctx.body).toEqual({ ok: true })
  })

  test('oversized urlencoded form rejected', async () => {
    const big = 'a=' + 'x'.repeat(5000)
    const req = createRequest(big, 'application/x-www-form-urlencoded', 'POST', 'http://localhost/test', {
      'content-length': String(Buffer.byteLength(big)),
    })
    const { ctx } = await run({ form: { limit: '1kb' } }, req)
    expect(ctx.response._status).toBe(413)
  })
})

describe('urlencoded arrayLimit', () => {
  test('repeated-key array growth is capped at arrayLimit', async () => {
    // Repeating the same plain key produces an array; arrayLimit bounds it.
    const pairs = Array.from({ length: 300 }, () => 'a=1').join('&')
    const req = createRequest(pairs, 'application/x-www-form-urlencoded')
    const { ctx } = await run({ form: { queryString: { arrayLimit: 50 } } }, req)
    expect(Array.isArray(ctx.body.a)).toBe(true)
    expect(ctx.body.a.length).toBe(50)
  })
})
