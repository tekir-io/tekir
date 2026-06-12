/**
 * Smoke test for the contributor playground. Exercises every route in
 * `server.ts`. The DB is auto-set to `:memory:` because `NODE_ENV=test`
 * during `bun test`, so the dev sqlite file isn't touched.
 */
import { describe, test, expect } from 'bun:test'
import { request } from './setup'

describe('example app', () => {
  test('GET / returns the welcome payload', async () => {
    const res = await request.get('/')
    res.assertOk()
    expect(res.body.message).toBe('tekir example app')
  })

  test('GET /health returns ok', async () => {
    const res = await request.get('/health')
    res.assertOk()
    expect(res.body.status).toBe('ok')
    expect(typeof res.body.uptime).toBe('number')
  })

  test('GET /users lists the seeded user', async () => {
    const res = await request.get('/users')
    res.assertOk()
    expect(res.body.length).toBeGreaterThanOrEqual(1)
    expect(res.body[0].name).toBe('kubilay')
  })

  test('POST /users creates a row, GET /users/:id reads it back', async () => {
    const created = await request.post('/users', { body: { name: 'ali', email: 'ali@tekir.io' } })
    created.assertOk()
    const newId = created.body.id

    const fetched = await request.get(`/users/${newId}`)
    fetched.assertOk()
    expect(fetched.body.name).toBe('ali')
  })

  test('POST /echo reflects the body back', async () => {
    const res = await request.post('/echo', { body: { ping: 'pong' } })
    res.assertOk()
    expect(res.body.received.ping).toBe('pong')
  })
})
