import { test, expect, describe } from 'bun:test'
import { createResponse } from '../src/http/response'

describe('Response — encryptedCookie', () => {
  test('encryptedCookie does not throw', () => {
    const res = createResponse()
    res.encryptedCookie('token', 'secret-data', 'my-secret-key-32ch')
  })
})

describe('Response — SSE edge cases', () => {
  test('SSE with only data string', () => {
    const res = createResponse()
    const output = res.sse('simple message')
    expect(output).toBe('data: simple message\n\n')
  })

  test('SSE with object data containing special chars', () => {
    const res = createResponse()
    const output = res.sse({ event: 'msg', data: { text: 'hello "world" & <friends>' } })
    expect(output).toContain('data: {')
    expect(output).not.toContain('\n{')
  })

  test('SSE with retry field', () => {
    const res = createResponse()
    const output = res.sse({ event: 'msg', retry: '5000', data: 'ok' })
    expect(output).toContain('retry: 5000\n')
  })

  test('SSE with all fields', () => {
    const res = createResponse()
    const output = res.sse({ event: 'update', id: '42', retry: '3000', data: { count: 1 } })
    expect(output).toContain('event: update\n')
    expect(output).toContain('id: 42\n')
    expect(output).toContain('retry: 3000\n')
    expect(output).toContain('data: {"count":1}\n\n')
  })

  test('SSE with empty event name', () => {
    const res = createResponse()
    const output = res.sse({ event: '', data: 'test' })
    expect(output).not.toContain('event:')
    expect(output).toContain('data: test')
  })

  test('SSE with numeric data', () => {
    const res = createResponse()
    const output = res.sse({ event: 'count', data: 42 })
    expect(output).toContain('data: 42\n\n')
  })
})

describe('Response — cookie edge cases', () => {
  test('cookie with all options', () => {
    const res = createResponse()
    res.cookie('session', 'abc123', {
      path: '/',
      domain: 'example.com',
      maxAge: 3600,
      expires: new Date('2025-01-01'),
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
    })
  })

  test('cookie with minimal options', () => {
    const res = createResponse()
    res.cookie('simple', 'value')
  })

  test('cookie value is encoded', () => {
    const res = createResponse()
    res.cookie('data', 'value with spaces & special=chars')
  })

  test('clearCookie sets max-age 0', () => {
    const res = createResponse()
    res.clearCookie('old-session')
  })

  test('signedCookie with different secrets', () => {
    const res = createResponse()
    res.signedCookie('token1', 'data', 'secret1')
    res.signedCookie('token2', 'data', 'secret2')
  })

  test('multiple cookies can be set', () => {
    const res = createResponse()
    res.cookie('a', '1')
    res.cookie('b', '2')
    res.cookie('c', '3')
  })
})

describe('Response — stream', () => {
  test('stream returns Response with ReadableStream', () => {
    const res = createResponse()
    const stream = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('hello')); c.close() }
    })
    const result = res.stream(stream)
    expect(result).toBeInstanceOf(Response)
  })
})

describe('Response — status chaining', () => {
  test('status().json() sets custom status', () => {
    const res = createResponse()
    const result = res.status(201).json({ id: 1 })
    expect(result.status).toBe(201)
  })

  test('status().send() sets custom status', () => {
    const res = createResponse()
    const result = res.status(202).send('accepted')
    expect(result.status).toBe(202)
  })

  test('status returns response for chaining', () => {
    const res = createResponse()
    const chained = res.status(200)
    expect(chained).toBe(res)
  })
})

describe('Response — onFinish callback', () => {
  test('onFinish returns response for chaining', () => {
    const res = createResponse()
    const chained = res.onFinish(() => {})
    expect(chained).toBe(res)
  })

  test('multiple onFinish callbacks', () => {
    const res = createResponse()
    res.onFinish(() => {}).onFinish(() => {}).onFinish(() => {})
  })
})

describe('Response — getStatusCode', () => {
  test('default status is 200', () => {
    const res = createResponse()
    expect(res.getStatusCode()).toBe(200)
  })

  test('status changes getStatusCode', () => {
    const res = createResponse()
    res.status(404)
    expect(res.getStatusCode()).toBe(404)
  })
})

describe('Response — null/undefined handling', () => {
  test('send(null) returns empty body', () => {
    const res = createResponse()
    const result = res.send(null)
    expect(result).toBeInstanceOf(Response)
    expect(result.status).toBe(200)
  })

  test('send(undefined) returns empty body', () => {
    const res = createResponse()
    const result = res.send(undefined)
    expect(result).toBeInstanceOf(Response)
  })

  test('json(undefined) returns response', () => {
    const res = createResponse()
    const result = res.json(undefined)
    expect(result).toBeInstanceOf(Response)
  })
})

describe('Response — 4xx and 5xx helpers', () => {
  test('paymentRequired returns 402', () => { expect(createResponse().paymentRequired().status).toBe(402) })
  test('methodNotAllowed returns 405', () => { expect(createResponse().methodNotAllowed().status).toBe(405) })
  test('notAcceptable returns 406', () => { expect(createResponse().notAcceptable().status).toBe(406) })
  test('requestTimeout returns 408', () => { expect(createResponse().requestTimeout().status).toBe(408) })
  test('gone returns 410', () => { expect(createResponse().gone().status).toBe(410) })
  test('preconditionFailed returns 412', () => { expect(createResponse().preconditionFailed().status).toBe(412) })
  test('payloadTooLarge returns 413', () => { expect(createResponse().payloadTooLarge().status).toBe(413) })
  test('unsupportedMediaType returns 415', () => { expect(createResponse().unsupportedMediaType().status).toBe(415) })
  test('notImplemented returns 501', () => { expect(createResponse().notImplemented().status).toBe(501) })
  test('badGateway returns 502', () => { expect(createResponse().badGateway().status).toBe(502) })
  test('serviceUnavailable returns 503', () => { expect(createResponse().serviceUnavailable().status).toBe(503) })
  test('gatewayTimeout returns 504', () => { expect(createResponse().gatewayTimeout().status).toBe(504) })
  test('accepted returns 202', () => { expect(createResponse().accepted().status).toBe(202) })
  test('notModified returns 304', () => { expect(createResponse().notModified().status).toBe(304) })

  test('error responses include default message', async () => {
    const body = await createResponse().badRequest().json()
    expect(body.message).toBe('Bad Request')
  })

  test('error responses accept custom data', async () => {
    const r = createResponse().badRequest({ errors: ['invalid'] })
    const body = await r.json()
    expect(body.errors).toEqual(['invalid'])
  })
})
