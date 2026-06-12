import { test, expect, describe } from 'bun:test'
import { TekirServer } from '../src/server/server'

// Boots a server on an ephemeral port, runs `fn(baseUrl)`, then stops it.
async function withServer(configure: (s: TekirServer) => void, fn: (base: string) => Promise<void>) {
  const server = new TekirServer()
  configure(server)
  server.configure({ port: 0 })
  server.start()
  const port = (server as any).server?.port
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    server.stop()
  }
}

describe('generator routes — streaming', () => {
  test('sync generator (function*) streams instead of returning {}', async () => {
    await withServer(
      (s) => {
        s.getRouter().get('/sync', function* () {
          yield 'data: sync1\n\n'
          yield 'data: sync2\n\n'
          yield 'data: [DONE]\n\n'
        })
      },
      async (base) => {
        const res = await fetch(`${base}/sync`)
        const text = await res.text()
        expect(text).toContain('data: sync1')
        expect(text).toContain('data: [DONE]')
        expect(text).not.toBe('{}')
        expect(res.headers.get('content-type')).toContain('text/event-stream')
      },
    )
  })

  test('async generator (async function*) streams instead of returning {}', async () => {
    await withServer(
      (s) => {
        s.getRouter().get('/async', async function* () {
          yield 'data: async1\n\n'
          await new Promise((r) => setTimeout(r, 10))
          yield 'data: async2\n\n'
          yield 'data: [DONE]\n\n'
        })
      },
      async (base) => {
        const res = await fetch(`${base}/async`)
        const text = await res.text()
        expect(text).toContain('data: async1')
        expect(text).toContain('data: async2')
        expect(text).toContain('data: [DONE]')
        expect(text).not.toBe('{}')
        expect(res.headers.get('content-type')).toContain('text/event-stream')
      },
    )
  })

  test('async generator through a middleware also streams', async () => {
    await withServer(
      (s) => {
        s.getRouter()
          .get('/mw', async function* () {
            yield 'data: mw1\n\n'
            yield 'data: [DONE]\n\n'
          })
          .use(async (_c: any, next: () => Promise<void>) => { await next() })
      },
      async (base) => {
        const res = await fetch(`${base}/mw`)
        const text = await res.text()
        expect(text).toContain('data: mw1')
        expect(text).toContain('data: [DONE]')
        expect(res.headers.get('content-type')).toContain('text/event-stream')
      },
    )
  })

  test('non-SSE object stream goes out as text/plain newline-delimited JSON', async () => {
    await withServer(
      (s) => {
        s.getRouter().get('/json-stream', async function* () {
          yield { n: 1 }
          yield { n: 2 }
        })
      },
      async (base) => {
        const res = await fetch(`${base}/json-stream`)
        const text = await res.text()
        expect(res.headers.get('content-type')).toContain('text/plain')
        expect(text).toContain('{"n":1}')
        expect(text).toContain('{"n":2}')
      },
    )
  })

  test('plain object route is unaffected', async () => {
    await withServer(
      (s) => {
        s.getRouter().get('/plain', () => ({ ok: true }))
      },
      async (base) => {
        const res = await fetch(`${base}/plain`)
        expect(res.headers.get('content-type')).toContain('application/json')
        expect(await res.json()).toEqual({ ok: true })
      },
    )
  })
})
