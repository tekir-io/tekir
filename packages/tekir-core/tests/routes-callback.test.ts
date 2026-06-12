import { test, expect, describe } from 'bun:test'
import { tekir } from '../src/tekir'

describe('tekir() routes callback', () => {
  test('registers routes from inline callback', async () => {
    const app = await tekir({
      config: { app: { port: 0, env: 'test' } },
      routes: (router) => {
        router.get('/inline', () => ({ ok: true }))
      },
    })

    const res = await app.server.handle(new Request('http://localhost/inline'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('destructured methods stay bound', async () => {
    const app = await tekir({
      config: { app: { port: 0, env: 'test' } },
      routes: ({ get, post }) => {
        get('/hello', () => ({ msg: 'hi' }))
        post('/echo', ({ body }) => ({ received: body }))
      },
    })

    const r1 = await app.server.handle(new Request('http://localhost/hello'))
    expect(await r1.json()).toEqual({ msg: 'hi' })

    const r2 = await app.server.handle(new Request('http://localhost/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    }))
    expect(await r2.json()).toEqual({ received: { a: 1 } })
  })

  test('async routes callback is awaited before tekir() resolves', async () => {
    let order = ''
    const app = await tekir({
      config: { app: { port: 0, env: 'test' } },
      routes: async (router) => {
        await new Promise(r => setTimeout(r, 5))
        order += 'cb'
        router.get('/late', () => ({ done: true }))
      },
    })
    order += '|after'

    expect(order).toBe('cb|after')
    const res = await app.server.handle(new Request('http://localhost/late'))
    expect(await res.json()).toEqual({ done: true })
  })
})
