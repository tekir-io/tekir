import { test, expect, describe, beforeEach } from 'bun:test'
import { MemoryStore, RedisStore, DatabaseStore } from '../src/store'
import { limiter, Limiter, define } from '../src/index'
import type { LimiterStore, LimiterResult } from '../src/store'
import type { LimiterOptions } from '../src/index'


describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  test('first request is allowed', async () => {
    const result = await store.check('key1', 5, 60_000)
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(5)
    expect(result.remaining).toBe(4)
  })

  test('subsequent requests within limit are allowed', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await store.check('key2', 5, 60_000)
      expect(r.allowed).toBe(true)
    }
  })

  test('request exceeding max is denied', async () => {
    for (let i = 0; i < 5; i++) await store.check('key3', 5, 60_000)
    const over = await store.check('key3', 5, 60_000)
    expect(over.allowed).toBe(false)
    expect(over.remaining).toBe(0)
  })

  test('remaining decrements with each request', async () => {
    const r1 = await store.check('key4', 3, 60_000)
    const r2 = await store.check('key4', 3, 60_000)
    const r3 = await store.check('key4', 3, 60_000)
    expect(r1.remaining).toBe(2)
    expect(r2.remaining).toBe(1)
    expect(r3.remaining).toBe(0)
  })

  test('resetTime is a positive number of seconds', async () => {
    const result = await store.check('key5', 5, 60_000)
    expect(result.resetTime).toBeGreaterThan(0)
    expect(result.resetTime).toBeLessThanOrEqual(60)
  })

  test('reset clears the counter and allows requests again', async () => {
    for (let i = 0; i < 5; i++) await store.check('reset-key', 5, 60_000)
    const denied = await store.check('reset-key', 5, 60_000)
    expect(denied.allowed).toBe(false)

    await store.reset('reset-key')

    const allowed = await store.check('reset-key', 5, 60_000)
    expect(allowed.allowed).toBe(true)
    expect(allowed.remaining).toBe(4)
  })

  test('window expiry resets the counter', async () => {
    // Use a very short window (5 ms)
    for (let i = 0; i < 3; i++) await store.check('window-key', 3, 5)
    const denied = await store.check('window-key', 3, 5)
    expect(denied.allowed).toBe(false)

    await Bun.sleep(10)

    const fresh = await store.check('window-key', 3, 5)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(2)
  })

  test('different keys are tracked independently', async () => {
    for (let i = 0; i < 3; i++) await store.check('user:1', 3, 60_000)
    const denied = await store.check('user:1', 3, 60_000)
    expect(denied.allowed).toBe(false)

    // user:2 should still be clean
    const fresh = await store.check('user:2', 3, 60_000)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(2)
  })

  test('reset on a non-existent key does not throw', async () => {
    await expect(store.reset('phantom-key')).resolves.toBeUndefined()
  })

  test('result shape is complete', async () => {
    const result = await store.check('shape-key', 10, 60_000)
    expect(result).toHaveProperty('allowed')
    expect(result).toHaveProperty('limit')
    expect(result).toHaveProperty('remaining')
    expect(result).toHaveProperty('resetTime')
    expect(typeof result.allowed).toBe('boolean')
    expect(typeof result.limit).toBe('number')
    expect(typeof result.remaining).toBe('number')
    expect(typeof result.resetTime).toBe('number')
  })

  test('limit field always reflects the configured max', async () => {
    const r = await store.check('limit-key', 42, 60_000)
    expect(r.limit).toBe(42)
  })
})


describe('DatabaseStore', () => {
  let store: DatabaseStore

  beforeEach(() => {
    // DatabaseStore uses db.queryOne(sql, ...params) and db.run(sql, ...params).
    // Raw bun:sqlite Database does not have queryOne; we wrap it.
    const { Database } = require('bun:sqlite')
    const rawDb = new Database(':memory:', { create: true })
    const dbWrapper = {
      run: async (sql: string, ...params: any[]) => rawDb.run(sql, ...params),
      exec: async (sql: string) => rawDb.run(sql),
      queryOne: async (sql: string, ...params: any[]) => rawDb.query(sql).get(...params) ?? null,
      query: async (sql: string, ...params: any[]) => rawDb.query(sql).all(...params),
    }
    store = new DatabaseStore(dbWrapper)
  })

  test('first request is allowed', async () => {
    const result = await store.check('db-key1', 5, 60_000)
    expect(result.allowed).toBe(true)
    expect(result.limit).toBe(5)
    expect(result.remaining).toBe(4)
  })

  test('request exceeding max is denied', async () => {
    for (let i = 0; i < 5; i++) await store.check('db-key2', 5, 60_000)
    const over = await store.check('db-key2', 5, 60_000)
    expect(over.allowed).toBe(false)
    expect(over.remaining).toBe(0)
  })

  test('reset clears the counter', async () => {
    for (let i = 0; i < 5; i++) await store.check('db-reset', 5, 60_000)
    await store.reset('db-reset')
    const fresh = await store.check('db-reset', 5, 60_000)
    expect(fresh.allowed).toBe(true)
  })

  test('different keys are tracked independently', async () => {
    for (let i = 0; i < 3; i++) await store.check('db-user:1', 3, 60_000)
    const denied = await store.check('db-user:1', 3, 60_000)
    expect(denied.allowed).toBe(false)

    const fresh = await store.check('db-user:2', 3, 60_000)
    expect(fresh.allowed).toBe(true)
  })
})


describe('MemoryStore (additional)', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  test('many concurrent keys are tracked independently', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => `concurrent:${i}`)
    await Promise.all(keys.map(k => store.check(k, 1, 60_000)))
    // Each key should have used 1 of 1
    for (const k of keys) {
      const r = await store.check(k, 1, 60_000)
      expect(r.allowed).toBe(false)
      expect(r.remaining).toBe(0)
    }
  })

  test('window boundary: request right at window expiry resets', async () => {
    await store.check('boundary', 1, 1) // 1ms window
    await Bun.sleep(5)
    const r = await store.check('boundary', 1, 1)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(0) // 1 - 1 = 0
  })

  test('max of zero denies every request', async () => {
    const r = await store.check('zero-max', 0, 60_000)
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
  })

  test('very high max allows many requests', async () => {
    const max = 100_000
    const r = await store.check('high-max', max, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(max - 1)
  })

  test('rapid sequential calls decrement correctly', async () => {
    const results: LimiterResult[] = []
    for (let i = 0; i < 10; i++) {
      results.push(await store.check('rapid', 10, 60_000))
    }
    for (let i = 0; i < 10; i++) {
      expect(results[i].remaining).toBe(10 - (i + 1))
    }
  })

  test('remaining never goes below zero', async () => {
    for (let i = 0; i < 10; i++) await store.check('floor', 3, 60_000)
    const r = await store.check('floor', 3, 60_000)
    expect(r.remaining).toBe(0)
  })

  test('reset then immediate check starts fresh count at 1', async () => {
    await store.check('fresh-count', 5, 60_000)
    await store.check('fresh-count', 5, 60_000)
    await store.reset('fresh-count')
    const r = await store.check('fresh-count', 5, 60_000)
    expect(r.remaining).toBe(4) // max(5) - count(1) = 4
  })

  test('window=0 means every check starts a new window', async () => {
    // With windowMs=0, now >= resetAt (which is now + 0 = now) is true,
    // so each check resets the counter
    const r1 = await store.check('win0', 1, 0)
    const r2 = await store.check('win0', 1, 0)
    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)
  })

  test('max=1 allows exactly one request per window', async () => {
    const r1 = await store.check('max1', 1, 60_000)
    const r2 = await store.check('max1', 1, 60_000)
    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(false)
  })

  test('empty string identifier works as a key', async () => {
    const r = await store.check('', 5, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.limit).toBe(5)
  })
})


describe('RedisStore (mocked)', () => {
  function createMockRedis() {
    const data: Record<string, { value: number; ttl: number }> = {}
    return {
      incr: async (key: string) => {
        if (!data[key]) data[key] = { value: 0, ttl: -1 }
        data[key].value++
        return data[key].value
      },
      expire: async (key: string, sec: number) => {
        if (data[key]) data[key].ttl = sec
      },
      ttl: async (key: string) => {
        return data[key]?.ttl ?? -2
      },
      del: async (key: string) => {
        delete data[key]
      },
      _data: data,
    }
  }

  test('first check returns allowed with count=1', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    const r = await store.check('test-key', 5, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
    expect(r.limit).toBe(5)
  })

  test('sets expire on first request (count===1)', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('ttl-key', 5, 30_000)
    expect(redis._data['rl:ttl-key'].ttl).toBe(30)
  })

  test('does not reset expire on subsequent requests', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('no-reset', 5, 30_000)
    // Simulate TTL counting down
    redis._data['rl:no-reset'].ttl = 20
    await store.check('no-reset', 5, 30_000)
    // TTL should still be 20, not reset to 30
    expect(redis._data['rl:no-reset'].ttl).toBe(20)
  })

  test('exceeding max returns not allowed', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    for (let i = 0; i < 3; i++) await store.check('exceed', 3, 60_000)
    const r = await store.check('exceed', 3, 60_000)
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
  })

  test('reset deletes the prefixed key', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('del-key', 5, 60_000)
    expect(redis._data['rl:del-key']).toBeDefined()
    await store.reset('del-key')
    expect(redis._data['rl:del-key']).toBeUndefined()
  })

  test('key prefix is always rl:', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('my-key', 5, 60_000)
    expect(Object.keys(redis._data)).toContain('rl:my-key')
  })

  test('resetTime uses ttl value when positive', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('ttl-pos', 5, 60_000)
    redis._data['rl:ttl-pos'].ttl = 42
    const r = await store.check('ttl-pos', 5, 60_000)
    expect(r.resetTime).toBe(42)
  })

  test('resetTime falls back to windowSec when ttl is non-positive', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('ttl-neg', 5, 10_000)
    redis._data['rl:ttl-neg'].ttl = -1
    const r = await store.check('ttl-neg', 5, 10_000)
    expect(r.resetTime).toBe(10)
  })
})


describe('limiter() middleware', () => {
  function createMockCtx(overrides: any = {}) {
    const headers: Record<string, string> = {}
    return {
      request: {
        ip: '127.0.0.1',
        header: (name: string) => null,
        ...overrides.request,
      },
      response: {
        header: (name: string, value: string) => { headers[name] = value },
      },
      route: { pattern: '/api/test', ...overrides.route },
      auth: overrides.auth || undefined,
      _headers: headers,
      ...overrides,
    }
  }

  test('returns a function', () => {
    const mw = limiter({ max: 10, window: 60 })
    expect(typeof mw).toBe('function')
  })

  test('sets X-RateLimit-Limit header', async () => {
    const mw = limiter({ max: 10, window: 60, store: new MemoryStore() })
    const ctx = createMockCtx()
    await mw(ctx as any, async () => {})
    expect(ctx._headers['X-RateLimit-Limit']).toBe('10')
  })

  test('sets X-RateLimit-Remaining header', async () => {
    const mw = limiter({ max: 10, window: 60, store: new MemoryStore() })
    const ctx = createMockCtx()
    await mw(ctx as any, async () => {})
    expect(ctx._headers['X-RateLimit-Remaining']).toBe('9')
  })

  test('sets X-RateLimit-Reset header', async () => {
    const mw = limiter({ max: 10, window: 60, store: new MemoryStore() })
    const ctx = createMockCtx()
    await mw(ctx as any, async () => {})
    expect(ctx._headers['X-RateLimit-Reset']).toBeDefined()
    expect(Number(ctx._headers['X-RateLimit-Reset'])).toBeGreaterThan(0)
  })

  test('calls next() when within limit', async () => {
    const mw = limiter({ max: 5, window: 60, store: new MemoryStore() })
    const ctx = createMockCtx()
    let nextCalled = false
    await mw(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('throws when limit exceeded', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 60, store })
    const ctx1 = createMockCtx()
    await mw(ctx1 as any, async () => {})
    const ctx2 = createMockCtx()
    await expect(mw(ctx2 as any, async () => {})).rejects.toThrow()
  })

  test('uses IP by default for key generation', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 60, store })
    // Two different IPs should not share limits
    const ctx1 = createMockCtx({ request: { ip: '10.0.0.1', header: () => null } })
    const ctx2 = createMockCtx({ request: { ip: '10.0.0.2', header: () => null } })
    await mw(ctx1 as any, async () => {})
    let nextCalled = false
    await mw(ctx2 as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('uses custom function for key generation via by option', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 60, store, by: (ctx: any) => ctx.request.customId })
    const ctx1 = createMockCtx({ request: { ip: '1.1.1.1', customId: 'user-A', header: () => null } })
    const ctx2 = createMockCtx({ request: { ip: '2.2.2.2', customId: 'user-A', header: () => null } })
    await mw(ctx1 as any, async () => {})
    // Same customId, so second request should be denied
    await expect(mw(ctx2 as any, async () => {})).rejects.toThrow()
  })

  test('keyPrefix option customizes the key prefix', async () => {
    // Different prefixes should not share limits
    const store = new MemoryStore()
    const mw1 = limiter({ max: 1, window: 60, store, keyPrefix: 'api' })
    const mw2 = limiter({ max: 1, window: 60, store, keyPrefix: 'web' })
    const ctx = createMockCtx()
    await mw1(ctx as any, async () => {})
    // Different prefix, same IP/route should still be allowed
    let nextCalled = false
    await mw2(ctx as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })
})


describe('limiter() middleware — extended', () => {
  function createMockCtx(overrides: any = {}) {
    const headers: Record<string, string> = {}
    return {
      request: {
        ip: '127.0.0.1',
        header: (name: string) => null,
        ...overrides.request,
      },
      response: {
        header: (name: string, value: string) => { headers[name] = value },
      },
      route: { pattern: '/api/test', ...overrides.route },
      auth: overrides.auth || undefined,
      _headers: headers,
      ...overrides,
    }
  }

  test('headers reflect remaining count after multiple requests', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 5, window: 60, store })
    for (let i = 0; i < 3; i++) {
      const ctx = createMockCtx()
      await mw(ctx as any, async () => {})
    }
    const ctx = createMockCtx()
    await mw(ctx as any, async () => {})
    expect(ctx._headers['X-RateLimit-Remaining']).toBe('1')
  })

  test('X-RateLimit-Limit stays constant across requests', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 7, window: 60, store })
    for (let i = 0; i < 3; i++) {
      const ctx = createMockCtx()
      await mw(ctx as any, async () => {})
      expect(ctx._headers['X-RateLimit-Limit']).toBe('7')
    }
  })

  test('same route same IP exhausts limit', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 2, window: 60, store })
    const ctx1 = createMockCtx()
    const ctx2 = createMockCtx()
    await mw(ctx1 as any, async () => {})
    await mw(ctx2 as any, async () => {})
    // Third request with same IP and route should be denied
    const ctx3 = createMockCtx()
    await expect(mw(ctx3 as any, async () => {})).rejects.toThrow()
  })

  test('custom by function with user id', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 2, window: 60, store, by: (ctx: any) => `user:${ctx.auth?.id}` })
    const ctx1 = createMockCtx({ auth: { id: 1 } })
    const ctx2 = createMockCtx({ auth: { id: 1 } })
    await mw(ctx1 as any, async () => {})
    await mw(ctx2 as any, async () => {})
    // Same user, third request denied
    const ctx3 = createMockCtx({ auth: { id: 1 } })
    await expect(mw(ctx3 as any, async () => {})).rejects.toThrow()
    // Different user still allowed
    const ctx4 = createMockCtx({ auth: { id: 2 } })
    let allowed = false
    await mw(ctx4 as any, async () => { allowed = true })
    expect(allowed).toBe(true)
  })

  test('window expiry resets rate limit in middleware', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 0.001, store }) // 1ms window
    const ctx1 = createMockCtx()
    await mw(ctx1 as any, async () => {})
    await Bun.sleep(10)
    // After window expiry, should be allowed again
    const ctx2 = createMockCtx()
    let nextCalled = false
    await mw(ctx2 as any, async () => { nextCalled = true })
    expect(nextCalled).toBe(true)
  })

  test('multiple limiters on same route with same store', async () => {
    const store = new MemoryStore()
    const strictLimiter = limiter({ max: 1, window: 60, store, keyPrefix: 'strict' })
    const looseLimiter = limiter({ max: 100, window: 60, store, keyPrefix: 'loose' })

    const ctx1 = createMockCtx()
    await strictLimiter(ctx1 as any, async () => {})
    // Strict limit exhausted
    const ctx2 = createMockCtx()
    await expect(strictLimiter(ctx2 as any, async () => {})).rejects.toThrow()
    // Loose limit still available
    const ctx3 = createMockCtx()
    let allowed = false
    await looseLimiter(ctx3 as any, async () => { allowed = true })
    expect(allowed).toBe(true)
  })

  test('max of 0 denies immediately', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 0, window: 60, store })
    const ctx = createMockCtx()
    await expect(mw(ctx as any, async () => {})).rejects.toThrow()
  })

  test('high concurrency with same key', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 5, window: 60, store })
    const results: boolean[] = []
    for (let i = 0; i < 10; i++) {
      const ctx = createMockCtx()
      try {
        await mw(ctx as any, async () => {})
        results.push(true)
      } catch {
        results.push(false)
      }
    }
    expect(results.filter(r => r).length).toBe(5)
    expect(results.filter(r => !r).length).toBe(5)
  })
})


describe('MemoryStore — edge cases', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  test('key with special characters', async () => {
    const r = await store.check('key:with/special@chars#!', 5, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })

  test('very long key works', async () => {
    const key = 'k'.repeat(1000)
    const r = await store.check(key, 5, 60_000)
    expect(r.allowed).toBe(true)
  })

  test('reset then check gives full quota', async () => {
    for (let i = 0; i < 5; i++) await store.check('full-reset', 5, 60_000)
    const denied = await store.check('full-reset', 5, 60_000)
    expect(denied.allowed).toBe(false)
    await store.reset('full-reset')
    const fresh = await store.check('full-reset', 5, 60_000)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(4)
  })

  test('different window sizes for same key pattern', async () => {
    // First key with short window
    await store.check('window:short', 1, 1)
    const d1 = await store.check('window:short', 1, 1)
    expect(d1.allowed).toBe(false)

    // Different key with long window
    const r2 = await store.check('window:long', 1, 60_000)
    expect(r2.allowed).toBe(true)
  })

  test('resetTime decreases over time', async () => {
    const r1 = await store.check('time-key', 5, 60_000)
    await Bun.sleep(5)
    const r2 = await store.check('time-key', 5, 60_000)
    expect(r2.resetTime).toBeLessThanOrEqual(r1.resetTime)
  })

  test('large number of different keys', async () => {
    for (let i = 0; i < 100; i++) {
      const r = await store.check(`bulk:${i}`, 1, 60_000)
      expect(r.allowed).toBe(true)
    }
    // Each key should be independently tracked
    for (let i = 0; i < 100; i++) {
      const r = await store.check(`bulk:${i}`, 1, 60_000)
      expect(r.allowed).toBe(false)
    }
  })
})


describe('DatabaseStore — extended', () => {
  let store: DatabaseStore

  beforeEach(() => {
    const { Database } = require('bun:sqlite')
    const rawDb = new Database(':memory:', { create: true })
    const dbWrapper = {
      run: async (sql: string, ...params: any[]) => rawDb.run(sql, ...params),
      exec: async (sql: string) => rawDb.run(sql),
      queryOne: async (sql: string, ...params: any[]) => rawDb.query(sql).get(...params) ?? null,
      query: async (sql: string, ...params: any[]) => rawDb.query(sql).all(...params),
    }
    store = new DatabaseStore(dbWrapper)
  })

  test('remaining decrements correctly', async () => {
    const r1 = await store.check('db-dec', 3, 60_000)
    const r2 = await store.check('db-dec', 3, 60_000)
    const r3 = await store.check('db-dec', 3, 60_000)
    expect(r1.remaining).toBe(2)
    expect(r2.remaining).toBe(1)
    expect(r3.remaining).toBe(0)
  })

  test('reset on non-existent key does not throw', async () => {
    await expect(store.reset('nonexistent')).resolves.toBeUndefined()
  })

  test('result shape is complete', async () => {
    const result = await store.check('shape', 10, 60_000)
    expect(result).toHaveProperty('allowed')
    expect(result).toHaveProperty('limit')
    expect(result).toHaveProperty('remaining')
    expect(result).toHaveProperty('resetTime')
  })
})


describe('MemoryStore — window timing precision', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  test('two sequential windows allow full quota each', async () => {
    // Exhaust window 1 (1ms window)
    await store.check('seq-win', 2, 1)
    await store.check('seq-win', 2, 1)
    const denied = await store.check('seq-win', 2, 1)
    expect(denied.allowed).toBe(false)

    // Wait for window to expire
    await Bun.sleep(5)

    // Window 2 should allow full quota again
    const r1 = await store.check('seq-win', 2, 1)
    const r2 = await store.check('seq-win', 2, 1)
    expect(r1.allowed).toBe(true)
    expect(r2.allowed).toBe(true)
  })

  test('resetTime is always non-negative', async () => {
    const r = await store.check('non-neg', 5, 1)
    expect(r.resetTime).toBeGreaterThanOrEqual(0)
  })

  test('max of 1 with reset allows one more', async () => {
    await store.check('max1-reset', 1, 60_000)
    const denied = await store.check('max1-reset', 1, 60_000)
    expect(denied.allowed).toBe(false)
    await store.reset('max1-reset')
    const fresh = await store.check('max1-reset', 1, 60_000)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(0)
  })

  test('multiple resets in a row do not throw', async () => {
    await store.check('multi-reset', 5, 60_000)
    await store.reset('multi-reset')
    await store.reset('multi-reset')
    await store.reset('multi-reset')
    const r = await store.check('multi-reset', 5, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4)
  })
})

describe('RedisStore — additional mock scenarios', () => {
  function createMockRedis() {
    const data: Record<string, { value: number; ttl: number }> = {}
    return {
      incr: async (key: string) => {
        if (!data[key]) data[key] = { value: 0, ttl: -1 }
        data[key].value++
        return data[key].value
      },
      expire: async (key: string, sec: number) => {
        if (data[key]) data[key].ttl = sec
      },
      ttl: async (key: string) => {
        return data[key]?.ttl ?? -2
      },
      del: async (key: string) => {
        delete data[key]
      },
      _data: data,
    }
  }

  test('reset then re-check starts fresh count', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    for (let i = 0; i < 3; i++) await store.check('fresh', 3, 60_000)
    const denied = await store.check('fresh', 3, 60_000)
    expect(denied.allowed).toBe(false)
    await store.reset('fresh')
    const fresh = await store.check('fresh', 3, 60_000)
    expect(fresh.allowed).toBe(true)
    expect(fresh.remaining).toBe(2)
  })

  test('multiple different keys tracked independently', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('alpha', 1, 60_000)
    const denied = await store.check('alpha', 1, 60_000)
    expect(denied.allowed).toBe(false)
    const other = await store.check('beta', 1, 60_000)
    expect(other.allowed).toBe(true)
  })

  test('reset on nonexistent key does not throw', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await expect(store.reset('ghost')).resolves.toBeUndefined()
  })

  test('window of 1 second sets expire to 1', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('short-win', 5, 1000)
    expect(redis._data['rl:short-win'].ttl).toBe(1)
  })

  test('window of 500ms rounds up to 1 second expire', async () => {
    const redis = createMockRedis()
    const store = new RedisStore(redis)
    await store.check('sub-sec', 5, 500)
    expect(redis._data['rl:sub-sec'].ttl).toBe(1)
  })
})

describe('DatabaseStore — window expiry and edge cases', () => {
  let store: DatabaseStore

  beforeEach(() => {
    const { Database } = require('bun:sqlite')
    const rawDb = new Database(':memory:', { create: true })
    const dbWrapper = {
      run: async (sql: string, ...params: any[]) => rawDb.run(sql, ...params),
      exec: async (sql: string) => rawDb.run(sql),
      queryOne: async (sql: string, ...params: any[]) => rawDb.query(sql).get(...params) ?? null,
      query: async (sql: string, ...params: any[]) => rawDb.query(sql).all(...params),
    }
    store = new DatabaseStore(dbWrapper)
  })

  test('window expiry resets the counter in DatabaseStore', async () => {
    await store.check('db-expire', 1, 1) // 1ms window
    const denied = await store.check('db-expire', 1, 1)
    // May or may not be denied depending on timing, but after sleep it resets
    await Bun.sleep(5)
    const fresh = await store.check('db-expire', 1, 1)
    expect(fresh.allowed).toBe(true)
  })

  test('limit field reflects max in DatabaseStore', async () => {
    const r = await store.check('db-limit', 42, 60_000)
    expect(r.limit).toBe(42)
  })

  test('many keys tracked independently in DatabaseStore', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await store.check(`db-multi:${i}`, 1, 60_000)
      expect(r.allowed).toBe(true)
    }
    for (let i = 0; i < 10; i++) {
      const r = await store.check(`db-multi:${i}`, 1, 60_000)
      expect(r.allowed).toBe(false)
    }
  })

  test('DatabaseStore with custom table name', () => {
    const { Database } = require('bun:sqlite')
    const rawDb = new Database(':memory:', { create: true })
    const dbWrapper = {
      run: async (sql: string, ...params: any[]) => rawDb.run(sql, ...params),
      exec: async (sql: string) => rawDb.run(sql),
      queryOne: async (sql: string, ...params: any[]) => rawDb.query(sql).get(...params) ?? null,
      query: async (sql: string, ...params: any[]) => rawDb.query(sql).all(...params),
    }
    const customStore = new DatabaseStore(dbWrapper, 'custom_limits')
    expect(customStore).toBeInstanceOf(DatabaseStore)
  })
})

describe('limiter() middleware — identifier strategies', () => {
  function createMockCtx(overrides: any = {}) {
    const headers: Record<string, string> = {}
    return {
      request: {
        ip: '127.0.0.1',
        header: (name: string) => null,
        ...overrides.request,
      },
      response: {
        header: (name: string, value: string) => { headers[name] = value },
      },
      route: { pattern: '/api/test', ...overrides.route },
      auth: overrides.auth || undefined,
      _headers: headers,
      ...overrides,
    }
  }

  test('different routes with same IP are tracked separately', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 60, store })
    const ctx1 = createMockCtx({ route: { pattern: '/route-a' } })
    await mw(ctx1 as any, async () => {})
    // Same IP but different route should still be allowed
    const ctx2 = createMockCtx({ route: { pattern: '/route-b' } })
    let allowed = false
    await mw(ctx2 as any, async () => { allowed = true })
    expect(allowed).toBe(true)
  })

  test('Retry-After-like info available via X-RateLimit-Reset on denial', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 60, store })
    const ctx1 = createMockCtx()
    await mw(ctx1 as any, async () => {})
    const ctx2 = createMockCtx()
    try {
      await mw(ctx2 as any, async () => {})
    } catch {}
    expect(ctx2._headers['X-RateLimit-Reset']).toBeDefined()
    expect(Number(ctx2._headers['X-RateLimit-Reset'])).toBeGreaterThan(0)
  })

  test('remaining is 0 on the last allowed request', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 3, window: 60, store })
    for (let i = 0; i < 2; i++) {
      const ctx = createMockCtx()
      await mw(ctx as any, async () => {})
    }
    const lastCtx = createMockCtx()
    await mw(lastCtx as any, async () => {})
    expect(lastCtx._headers['X-RateLimit-Remaining']).toBe('0')
  })

  test('by function returning empty string groups all requests', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 60, store, by: () => 'global' })
    const ctx1 = createMockCtx({ request: { ip: '1.1.1.1', header: () => null } })
    await mw(ctx1 as any, async () => {})
    const ctx2 = createMockCtx({ request: { ip: '2.2.2.2', header: () => null } })
    await expect(mw(ctx2 as any, async () => {})).rejects.toThrow()
  })
})


describe('Limiter class', () => {
  test('attempt runs fn when allowed', async () => {
    const l = new Limiter({ max: 2, window: 60 })
    const result = await l.attempt('test-attempt', () => 'hello')
    expect(result).toBe('hello')
  })

  test('attempt returns undefined when blocked', async () => {
    const l = new Limiter({ max: 1, window: 60 })
    await l.attempt('test-block', () => 'ok')
    const result = await l.attempt('test-block', () => 'should not run')
    expect(result).toBeUndefined()
  })

  test('attempt with async fn', async () => {
    const l = new Limiter({ max: 5, window: 60 })
    const result = await l.attempt('test-async', async () => {
      return 42
    })
    expect(result).toBe(42)
  })

  test('penalize does not consume on success', async () => {
    const l = new Limiter({ max: 3, window: 60 })
    const [err, result] = await l.penalize('pen-ok', () => 'success')
    expect(err).toBeNull()
    expect(result).toBe('success')
    // Should still have attempts left
    const [err2, result2] = await l.penalize('pen-ok', () => 'again')
    expect(err2).toBeNull()
    expect(result2).toBe('again')
  })

  test('penalize consumes on failure', async () => {
    const l = new Limiter({ max: 2, window: 60 })
    const [err1] = await l.penalize('pen-fail', () => { throw new Error('bad') })
    expect(err1).not.toBeNull()
    expect(err1!.retryAfter).toBeGreaterThan(0)
    const [err2] = await l.penalize('pen-fail', () => { throw new Error('bad') })
    expect(err2).not.toBeNull()
  })

  test('consume throws on limit exceeded', async () => {
    const l = new Limiter({ max: 1, window: 60 })
    await l.consume('con-key')
    await expect(l.consume('con-key')).rejects.toThrow()
  })

  test('consume with amount', async () => {
    const l = new Limiter({ max: 5, window: 60 })
    const r = await l.consume('con-amt', 3)
    expect(r.remaining).toBe(2)
    await expect(l.consume('con-amt', 3)).rejects.toThrow()
  })

  test('increment does not throw', async () => {
    const l = new Limiter({ max: 1, window: 60 })
    const r1 = await l.increment('inc-key')
    expect(r1.allowed).toBe(true)
    const r2 = await l.increment('inc-key')
    expect(r2.allowed).toBe(false)
  })

  test('decrement restores slots', async () => {
    const l = new Limiter({ max: 2, window: 60 })
    await l.consume('dec-key')
    await l.consume('dec-key')
    await l.decrement('dec-key')
    // Should be able to consume again
    const r = await l.increment('dec-key')
    expect(r.allowed).toBe(true)
  })

  test('block manually blocks a key', async () => {
    const l = new Limiter({ max: 100, window: 60 })
    await l.block('block-key', 60) // block for 60s
    const result = await l.attempt('block-key', () => 'nope')
    expect(result).toBeUndefined()
  })

  test('delete removes a key', async () => {
    const l = new Limiter({ max: 1, window: 60 })
    await l.consume('del-key')
    await l.delete('del-key')
    const r = await l.increment('del-key')
    expect(r.allowed).toBe(true)
  })

  test('clear flushes all keys', async () => {
    const store = new MemoryStore()
    const l = new Limiter({ max: 1, window: 60, store })
    await l.consume('c1')
    await l.consume('c2').catch(() => {})
    await l.clear()
    const r = await l.increment('c1')
    expect(r.allowed).toBe(true)
  })

  test('availableIn returns seconds', async () => {
    const l = new Limiter({ max: 1, window: 30 })
    await l.consume('avail-key')
    const secs = await l.availableIn('avail-key')
    expect(secs).toBeGreaterThan(0)
    expect(secs).toBeLessThanOrEqual(30)
  })

  test('blockFor option activates on limit exceeded', async () => {
    const l = new Limiter({ max: 1, window: 1, blockFor: 60 })
    await l.consume('bf-key')
    await l.consume('bf-key').catch(() => {})
    // Should be blocked for 60s, not 1s
    const secs = await l.availableIn('bf-key')
    expect(secs).toBeGreaterThan(1)
  })

  test('get returns null for unknown key', async () => {
    const l = new Limiter({ max: 5, window: 60 })
    const r = await l.get('nonexistent')
    expect(r).toBeNull()
  })
})

function mockCtx(overrides: any = {}) {
  const headers: Record<string, string> = {}
  return {
    request: { ip: '127.0.0.1', header: () => null, ...overrides.request },
    response: { header: (n: string, v: string) => { headers[n] = v } },
    route: { pattern: '/test', ...overrides.route },
    auth: overrides.auth || undefined,
    _headers: headers,
    ...overrides,
  }
}


describe('define()', () => {
  test('creates reusable middleware', async () => {
    const throttle = define('api', () => ({ max: 2, window: 60 }))
    expect(typeof throttle).toBe('function')
  })

  test('middleware enforces limits', async () => {
    const store = new MemoryStore()
    const throttle = define('def-test', () => ({ max: 1, window: 60, store }))
    const ctx = mockCtx()
    await throttle(ctx as any, async () => {})
    await expect(throttle(ctx as any, async () => {})).rejects.toThrow()
  })

  test('dynamic limits based on ctx', async () => {
    const store = new MemoryStore()
    const throttle = define('dynamic', (ctx: any) => ({
      max: ctx.auth?.user ? 100 : 5,
      window: 60,
      store,
    }))
    const authedCtx = mockCtx({ auth: { user: { id: 1 } } })
    // Should allow many requests for authed user
    for (let i = 0; i < 10; i++) {
      await throttle(authedCtx as any, async () => {})
    }
  })
})


describe('MemoryStore extended', () => {
  test('clear empties all entries', async () => {
    const store = new MemoryStore()
    await store.check('a', 1, 60000)
    await store.check('b', 1, 60000)
    await store.clear()
    const r = await store.check('a', 1, 60000)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(0)
  })

  test('block prevents check from succeeding', async () => {
    const store = new MemoryStore()
    await store.block('blocked', 60000)
    const r = await store.check('blocked', 100, 60000)
    expect(r.allowed).toBe(false)
  })

  test('increment by amount', async () => {
    const store = new MemoryStore()
    const r = await store.increment('inc', 10, 60000, 5)
    expect(r.remaining).toBe(5)
    const r2 = await store.increment('inc', 10, 60000, 6)
    expect(r2.allowed).toBe(false)
  })

  test('decrement restores count', async () => {
    const store = new MemoryStore()
    await store.check('dec', 2, 60000)
    await store.check('dec', 2, 60000)
    await store.decrement('dec', 1)
    const r = await store.check('dec', 2, 60000)
    expect(r.allowed).toBe(true)
  })

  test('get returns null for missing key', async () => {
    const store = new MemoryStore()
    expect(await store.get('nope')).toBeNull()
  })

  test('get returns info for blocked key', async () => {
    const store = new MemoryStore()
    await store.block('gblocked', 60000)
    const r = await store.get('gblocked')
    expect(r).not.toBeNull()
    expect(r!.allowed).toBe(false)
  })
})


describe('Retry-After header', () => {
  test('middleware does NOT set Retry-After when within limit', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 30, store })
    const ctx = mockCtx()
    await mw(ctx as any, async () => {})
    expect(ctx._headers['Retry-After']).toBeUndefined()
  })

  test('middleware sets Retry-After only once the limit is exceeded', async () => {
    const store = new MemoryStore()
    const mw = limiter({ max: 1, window: 30, store })
    const ctx = mockCtx()
    await mw(ctx as any, async () => {}) // first allowed
    const ctx2 = mockCtx()
    await Promise.resolve(mw(ctx2 as any, async () => {})).catch(() => {}) // second exceeds
    expect(ctx2._headers['Retry-After']).toBeDefined()
  })
})


describe('limitExceeded hook', () => {
  test('custom message via hook', async () => {
    const store = new MemoryStore()
    const mw = limiter({
      max: 1, window: 60, store,
      limitExceeded: (err) => {
        err.setMessage('Çok fazla istek')
        err.setStatus(400)
      },
    })
    const ctx = mockCtx()
    await mw(ctx as any, async () => {})
    try {
      await mw(ctx as any, async () => {})
      expect(true).toBe(false) // should not reach
    } catch (e: any) {
      expect(e.message).toBe('Çok fazla istek')
    }
  })
})
