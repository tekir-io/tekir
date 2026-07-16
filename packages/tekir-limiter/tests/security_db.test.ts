import { test, expect, describe, beforeEach } from 'bun:test'
import { DatabaseStore } from '../src/store'

function makeStore() {
  const { Database } = require('bun:sqlite')
  const rawDb = new Database(':memory:', { create: true })
  const dbWrapper = {
    run: async (sql: string, ...params: any[]) => rawDb.run(sql, ...params),
    exec: async (sql: string) => rawDb.run(sql),
    queryOne: async (sql: string, ...params: any[]) => rawDb.query(sql).get(...params) ?? null,
    query: async (sql: string, ...params: any[]) => rawDb.query(sql).all(...params),
  }
  return new DatabaseStore(dbWrapper)
}

describe('DatabaseStore atomic check', () => {
  let store: DatabaseStore
  beforeEach(() => { store = makeStore() })

  test('concurrent checks never exceed the limit (no lost updates)', async () => {
    // Fire many concurrent requests against the same key. With a non-atomic
    // read-modify-write, several would read the same count and double-write,
    // letting more than `max` through. The atomic upsert must allow exactly
    // `max`.
    const max = 5
    const total = 50
    const results = await Promise.all(
      Array.from({ length: total }, () => store.check('race-key', max, 60_000))
    )
    const allowedCount = results.filter(r => r.allowed).length
    expect(allowedCount).toBe(max)
  })

  test('sequential checks count up correctly and then deny', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await store.check('seq', 3, 60_000)
      expect(r.allowed).toBe(true)
    }
    const denied = await store.check('seq', 3, 60_000)
    expect(denied.allowed).toBe(false)
    expect(denied.remaining).toBe(0)
  })

  test('expired window starts a fresh count of 1', async () => {
    await store.check('win', 2, 1)
    await store.check('win', 2, 1)
    await new Promise(r => setTimeout(r, 10))
    const fresh = await store.check('win', 2, 60_000)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(1)
  })

  test('weighted consume uses the requested amount', async () => {
    const first = await store.consume('weighted', 5, 60_000, 3)
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(2)

    const second = await store.consume('weighted', 5, 60_000, 3)
    expect(second.allowed).toBe(false)
    expect(second.remaining).toBe(0)
    expect((await store.get('weighted'))?.allowed).toBe(false)
  })
})
