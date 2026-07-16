import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import { client } from '../src/client'

// Spin up a tiny test server using Bun.serve so we can hit a real socket.
// Avoids pulling @tekir/core into this package's tests.
let server: any
let baseUrl: string

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)

      if (req.method === 'OPTIONS' && url.pathname === '/cors') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': 'https://app.example',
            'Access-Control-Allow-Methods': 'GET, POST',
          },
        })
      }

      if (url.pathname === '/stream') {
        // Stream that emits chunks every 200ms — would normally hang
        // a body-draining client.
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('data: 1\n\n'))
            await new Promise(r => setTimeout(r, 200))
            controller.enqueue(new TextEncoder().encode('data: 2\n\n'))
            await new Promise(r => setTimeout(r, 200))
            controller.close()
          },
        })
        return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
      }

      if (url.pathname === '/wrapped-error') {
        return Response.json(
          { error: { message: 'Unauthorized', statusCode: 401, code: 'UNAUTHORIZED' } },
          { status: 401 },
        )
      }

      if (url.pathname === '/flat-error') {
        return Response.json({ message: 'Bad Request', statusCode: 400 }, { status: 400 })
      }

      if (url.pathname === '/head') {
        return new Response(null, { headers: { 'x-received': req.headers.get('x-test') ?? '' } })
      }

      return new Response('not found', { status: 404 })
    },
  })
  baseUrl = `http://localhost:${server.port}`
})

afterAll(() => server.stop())

describe('client.options()', () => {
  test('sends OPTIONS request and returns headers (CORS preflight)', async () => {
    const c = client(baseUrl)
    const res = await c.options('/cors')
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST')
  })
})

describe('client stream mode', () => {
  test('does not hang on streaming endpoint when stream:true', async () => {
    const c = client(baseUrl)
    const start = Date.now()
    const res = await c.get('/stream', { stream: true })
    const elapsed = Date.now() - start
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    // Without stream:true this would block until controller.close (~400ms);
    // with stream:true it returns immediately after headers arrive.
    expect(elapsed).toBeLessThan(150)
    expect(res.text).toBe('')
    // Caller can still read chunks from raw.body if they want
    expect(res.raw.body).toBeInstanceOf(ReadableStream)
  })
})

describe('assertError', () => {
  test('unwraps tekir HttpException envelope { error: {...} }', async () => {
    const c = client(baseUrl)
    const res = await c.get('/wrapped-error')
    res.assertStatus(401).assertError({ message: 'Unauthorized', statusCode: 401 })
  })

  test('matches a flat { message, statusCode } payload too', async () => {
    const c = client(baseUrl)
    const res = await c.get('/flat-error')
    res.assertError({ message: 'Bad Request', statusCode: 400 })
  })

  test('throws on mismatch', async () => {
    const c = client(baseUrl)
    const res = await c.get('/wrapped-error')
    expect(() => res.assertError({ message: 'wrong' })).toThrow()
  })
})

describe('client.withHeader()', () => {
  test('retains the HEAD method and applies the default header', async () => {
    const c = client(baseUrl).withHeader('x-test', 'present')
    const res = await c.head('/head')
    expect(res.status).toBe(200)
    expect(res.headers.get('x-received')).toBe('present')
  })
})
